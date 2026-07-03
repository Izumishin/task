#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""総目次Excelに月刊号1か月分を追記/置換するCLI。

想定運用（毎月Claudeに依頼）:
  1) Claude が当月PDFの目次＋本文を読み、記事の骨子（区分/表題/頁/著者順）を
     articles JSON にまとめる。
  2) 本CLI が本文ページからローマ字を拾い、既存Excelの読み辞書と合わせて
     I列（よみ）を自動解決し、対象月ブロックを置換してExcelを書き出す。
  3) 黄色セル（読みが曖昧な新規著者・不明区分）を Claude が該当PDFで確認して確定。

サブコマンド:
  dump   PDF群のページマップと目次テキストを表示（Claudeの骨子作成用）
  page   指定した誌面ページ番号の本文テキスト＋著者抽出結果を表示
  write  articles JSON を読み、対象月を置換したExcelを書き出す

articles JSON スキーマ:
{
  "month": 5,
  "articles": [
    {"section": "巻頭言", "title": "表題", "page": 3, "authors": ["岸本年史"]},
    {"section": "特集",  "title": "表題\n―― 副題", "page": 13,
     "authors": ["伏屋研二", "笠貫浩史", "中川敦夫"]},
    {"section": "特集",  "title": "特集総合テーマ", "page": 13, "theme": true},
    {"section": "文献抄録", "title": "本文から取った表題", "page": 100,
     "authors": ["布村明彦"], "readings": {"布村明彦": "ぬのむら　あきひこ"}}
  ]
}
  - authors 省略 or theme:true の記事は著者なし行（頁も省略可）。
  - readings を明示すると辞書より優先（Claudeが確定した読みを固定できる）。
"""
import argparse
import json
import sys

import openpyxl

import toc_lib


def cmd_dump(args):
    pm, docs = toc_lib.build_page_map(args.pdf)
    print(f"# ページマップ: {len(pm)} ページ")
    nums = sorted(pm)
    print("誌面ページ:", nums[0], "〜", nums[-1])
    missing = [n for n in range(nums[0], nums[-1] + 1) if n not in pm]
    if missing:
        print("未検出ページ:", missing)
    print("\n# 目次ページ（誌面 p.1）テキスト " + "=" * 40)
    t = toc_lib.page_text(pm, docs, nums[0])
    print(t)


def cmd_page(args):
    pm, docs = toc_lib.build_page_map(args.pdf)
    t = toc_lib.page_text(pm, docs, args.num)
    if t is None:
        print(f"誌面ページ {args.num} が見つかりません", file=sys.stderr)
        sys.exit(1)
    art = toc_lib.extract_article(t)
    print(f"# 誌面 p.{args.num}")
    print("漢字著者(推定):", art["kanji_authors"])
    print("ローマ字著者   :", art["romaji_authors"])
    print("頁範囲         :", art["page_range"])
    print("-" * 60)
    print(t)


def _expand_rows(spec, pm, docs, reading_dict):
    """articles 指定を Excel 行 dict のリストへ展開し、読みを解決する。"""
    rows = []
    report = []
    for art in spec["articles"]:
        section = art["section"]
        title = art.get("title", "")
        page = art.get("page")
        explicit = art.get("readings", {})
        authors = [] if art.get("theme") else art.get("authors", [])

        if not authors:
            rows.append({"section": section, "title": title,
                         "page": page, "author": "", "reading": "",
                         "uncertain": False})
            continue

        # 本文ページのローマ字（新規著者の読み推定用）
        romaji = []
        if page and toc_lib.page_text(pm, docs, page):
            romaji = toc_lib.extract_article(
                toc_lib.page_text(pm, docs, page))["romaji_authors"]

        for idx, author in enumerate(authors):
            if author in explicit:
                reading, uncertain = explicit[author], False
            else:
                romaji_hint = romaji[idx] if idx < len(romaji) else None
                reading, uncertain = toc_lib.resolve_reading(
                    author, romaji_hint, reading_dict)
            if uncertain:
                report.append((section, author, reading, page))
            rows.append({"section": section, "title": title, "page": page,
                         "author": author, "reading": reading,
                         "uncertain": uncertain})
    return rows, report


def cmd_write(args):
    with open(args.rows, encoding="utf-8") as f:
        spec = json.load(f)
    month = args.month or spec.get("month")
    if not month:
        print("月が指定されていません（--month か JSON の month）", file=sys.stderr)
        sys.exit(1)

    wb = openpyxl.load_workbook(args.excel)
    ws = wb.active
    reading_dict = toc_lib.build_reading_dict(ws)
    b_map = toc_lib.section_b_strings(ws)

    pm, docs = ({}, {})
    if args.pdf:
        pm, docs = toc_lib.build_page_map(args.pdf)

    rows, report = _expand_rows(spec, pm, docs, reading_dict)
    n, yellow = toc_lib.write_month(ws, month, rows, b_map)
    wb.save(args.out)

    print(f"✅ {month}月号: {n} 行を書き込み → {args.out}")
    print(f"   著者行 {sum(1 for r in rows if r['author'])} / テーマ・見出し行 "
          f"{sum(1 for r in rows if not r['author'])}")
    if report:
        print(f"\n⚠️ 要確認（黄色セル） {len(report)} 件 — PDFで読みを確認してください:")
        for section, author, reading, page in report:
            print(f"   [{section}] p{page} {author} → 「{reading}」(推定)")
    else:
        print("\n読みはすべて既存辞書で確定（要確認なし）。")


def main():
    ap = argparse.ArgumentParser(description="総目次Excel 月次追記ツール")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("dump", help="ページマップと目次テキストを表示")
    d.add_argument("--pdf", nargs="+", required=True)
    d.set_defaults(func=cmd_dump)

    p = sub.add_parser("page", help="誌面ページの本文＋著者抽出を表示")
    p.add_argument("--pdf", nargs="+", required=True)
    p.add_argument("--num", type=int, required=True)
    p.set_defaults(func=cmd_page)

    w = sub.add_parser("write", help="articles JSON から対象月を置換")
    w.add_argument("--excel", required=True)
    w.add_argument("--rows", required=True, help="articles JSON")
    w.add_argument("--out", required=True)
    w.add_argument("--month", type=int)
    w.add_argument("--pdf", nargs="+", help="読み推定に使う当月PDF（任意）")
    w.set_defaults(func=cmd_write)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
