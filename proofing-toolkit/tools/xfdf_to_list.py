#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xfdf_to_list.py — Acrobatの注釈書き出し(XFDF)を修正指示リストCSVに変換する

デジタル注釈で赤字をくれる著者の分も、手書きスキャン分と同じ
「修正指示リスト」フォーマットに揃えるための変換ツール。

Acrobat側の操作:
    注釈パネル → オプション(…) → 「データファイルに書き出し」→ .xfdf を保存

使い方:
    py xfdf_to_list.py 注釈.xfdf
    (引数なしで実行するとファイル選択ダイアログが開きます)

注釈タイプの対応:
    テキスト置換(取り消し線+ポップアップ本文あり) → 置換
    取り消し線のみ                                   → 削除
    挿入記号(キャレット)                            → 挿入
    ハイライト/下線/波線・ノート注釈・テキストボックス → 照会(内容を備考へ)

制限: XFDFには「元の本文(修正前)」のテキストは含まれないため、
      修正前列は空になります。リストを見ながらPDF上の該当箇所を確認して
      埋めるか、アンカー列に注釈の対象語を転記してください。
"""

import csv
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

CSV_COLUMNS = ["No", "ページ", "アンカー", "指示種別", "修正前", "修正後",
               "自動置換可", "反映済", "検証結果", "備考"]

NS = "{http://ns.adobe.com/xfdf/}"

# XFDF要素名 → (指示種別, 内容の扱い)
KIND_MAP = {
    "strikeout": "削除",     # 本文(contents)があれば「置換」に昇格
    "caret": "挿入",
    "highlight": "照会",
    "underline": "照会",
    "squiggly": "照会",
    "text": "照会",          # ノート注釈
    "freetext": "照会",      # テキストボックス
}


def get_contents(annot) -> str:
    """注釈のポップアップ本文を取り出す(リッチテキストにも対応)。"""
    c = annot.find(f"{NS}contents")
    if c is not None and c.text:
        return c.text.strip()
    rich = annot.find(f"{NS}contents-richtext")
    if rich is not None:
        return "".join(rich.itertext()).strip()
    return ""


def main():
    if len(sys.argv) >= 2:
        xfdf_path = sys.argv[1]
    else:
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            xfdf_path = filedialog.askopenfilename(
                title="Acrobatから書き出したXFDFを選択",
                filetypes=[("XFDF", "*.xfdf"), ("すべて", "*.*")])
            root.destroy()
        except ImportError:
            xfdf_path = None
        if not xfdf_path:
            print("使い方: py xfdf_to_list.py 注釈.xfdf")
            sys.exit(1)

    xfdf_path = Path(xfdf_path)
    tree = ET.parse(xfdf_path)
    annots_parent = tree.getroot().find(f"{NS}annots")
    if annots_parent is None:
        print("XFDF内に注釈が見つかりませんでした。")
        sys.exit(1)

    rows = []
    for annot in annots_parent:
        tag = annot.tag.replace(NS, "")
        if tag == "popup":
            continue
        kind = KIND_MAP.get(tag)
        if kind is None:
            continue
        contents = get_contents(annot)
        if tag == "strikeout" and contents:
            kind = "置換"
        page = int(annot.get("page", "0")) + 1  # XFDFは0始まり
        author = annot.get("title", "")
        date = (annot.get("date") or "")[2:10]  # D:YYYYMMDD... → YYYYMMDD

        row = {c: "" for c in CSV_COLUMNS}
        row["ページ"] = str(page)
        row["指示種別"] = kind
        if kind in ("置換", "挿入"):
            row["修正後"] = contents
        elif contents:
            row["備考"] = contents
        note = f"注釈タイプ:{tag}"
        if author:
            note += f" / 記入者:{author}"
        if date:
            note += f" / {date}"
        row["備考"] = (row["備考"] + " / " + note).strip(" /") if row["備考"] else note
        rows.append(row)

    # ページ順に並べて通し番号を振る
    rows.sort(key=lambda r: int(r["ページ"]))
    for i, row in enumerate(rows, 1):
        row["No"] = str(i)

    out = xfdf_path.with_name(xfdf_path.stem + "_修正指示リスト.csv")
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"完了: 注釈 {len(rows)}件をリスト化しました → {out}")
    print("※ XFDFには元の本文が含まれないため「修正前」列は空です。")
    print("  PDFの該当箇所を見て修正前・アンカーを補ってから利用してください。")


if __name__ == "__main__":
    main()
