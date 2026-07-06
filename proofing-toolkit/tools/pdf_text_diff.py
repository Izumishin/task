#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf_text_diff.py — 新旧PDFのテキストをページ単位で比較し、差分レポート(HTML)を作る

目的: 指示された修正「以外」の変化(流し込みズレによる文章の消失・重複、
      文字化けなどの組版事故)を発見する安全網。意図した修正も差分として
      出るので、「差分がすべて指示リストの項目で説明できるか」を見る。

使い方:
    py pdf_text_diff.py 修正前.pdf 修正後.pdf
    (引数なしで実行するとファイル選択ダイアログが開きます)

出力: 差分レポート.html (修正後PDFと同じフォルダ)
"""

import difflib
import html
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

try:
    from pdfminer.high_level import extract_text
    from pdfminer.pdfpage import PDFPage
except ImportError:
    print("pdfminer.six が見つかりません。コマンドプロンプトで")
    print("    py -m pip install pdfminer.six")
    print("を実行してから再度お試しください。")
    sys.exit(1)


def load_pdf_pages(pdf_path: Path) -> list:
    """ページごとに、比較しやすい形(文単位の行リスト)へ整形して返す。"""
    with open(pdf_path, "rb") as f:
        n_pages = sum(1 for _ in PDFPage.get_pages(f))
    pages = []
    for i in range(n_pages):
        text = extract_text(str(pdf_path), page_numbers=[i]) or ""
        text = unicodedata.normalize("NFKC", text)
        # 組版由来の行折り返しを除去して文単位に切り直す(「。」で区切る)
        joined = "".join(ch for ch in text if ch not in "\r\n")
        joined = joined.replace(" ", "").replace("　", "")
        lines = [s + "。" for s in joined.split("。") if s.strip()]
        pages.append(lines)
    return pages


def diff_pages(old: list, new: list) -> list:
    """ページごとの差分ブロック(HTML片)のリストを返す。"""
    blocks = []
    n = max(len(old), len(new))
    for i in range(n):
        o = old[i] if i < len(old) else []
        nw = new[i] if i < len(new) else []
        if o == nw:
            continue
        sm = difflib.SequenceMatcher(a=o, b=nw, autojunk=False)
        parts = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                continue
            for line in o[i1:i2]:
                parts.append(f'<div class="del">− {html.escape(line)}</div>')
            for line in nw[j1:j2]:
                parts.append(f'<div class="add">+ {html.escape(line)}</div>')
        if parts:
            blocks.append(f'<h2>{i + 1}ページ</h2>\n' + "\n".join(parts))
    return blocks


def main():
    if len(sys.argv) >= 3:
        old_path, new_path = sys.argv[1], sys.argv[2]
    else:
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            old_path = filedialog.askopenfilename(
                title="修正前のPDFを選択", filetypes=[("PDF", "*.pdf")])
            new_path = filedialog.askopenfilename(
                title="修正後のPDFを選択", filetypes=[("PDF", "*.pdf")])
            root.destroy()
        except ImportError:
            old_path = new_path = None
        if not old_path or not new_path:
            print("使い方: py pdf_text_diff.py 修正前.pdf 修正後.pdf")
            sys.exit(1)

    old_path, new_path = Path(old_path), Path(new_path)
    print(f"読み込み中: {old_path.name} ...")
    old_pages = load_pdf_pages(old_path)
    print(f"読み込み中: {new_path.name} ...")
    new_pages = load_pdf_pages(new_path)

    note = ""
    if len(old_pages) != len(new_pages):
        note = (f"<p><b>注意:</b> ページ数が異なります"
                f"(修正前 {len(old_pages)}ページ / 修正後 {len(new_pages)}ページ)。"
                f"改ページ位置がずれている場合、以降のページ差分は大きく出ます。</p>")

    blocks = diff_pages(old_pages, new_pages)
    report = f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<title>新旧PDF差分レポート</title>
<style>
 body {{ font-family: "Yu Gothic UI", "Meiryo", sans-serif; margin: 24px; }}
 h2 {{ border-bottom: 2px solid #ddd; padding-bottom: 4px; margin-top: 28px; }}
 .del {{ background: #fce8e6; padding: 3px 8px; margin: 2px 0; }}
 .add {{ background: #e6f4ea; padding: 3px 8px; margin: 2px 0; }}
 p.legend span {{ padding: 2px 8px; margin-right: 12px; }}
</style></head><body>
<h1>新旧PDF差分レポート</h1>
<p>修正前: {html.escape(old_path.name)}<br>
修正後: {html.escape(new_path.name)}<br>
実行日時: {datetime.now().strftime("%Y-%m-%d %H:%M")}</p>
{note}
<p class="legend"><span class="del">− 修正前にあった文</span>
<span class="add">+ 修正後にある文</span></p>
<p>差分が {len(blocks)} ページ分あります。
それぞれが修正指示リストの項目で説明できるか確認してください。
説明できない差分は組版事故(流し込みズレ等)の可能性があります。</p>
{''.join(blocks) if blocks else '<p><b>テキスト上の差分はありません。</b></p>'}
</body></html>"""

    out = new_path.parent / "差分レポート.html"
    out.write_text(report, encoding="utf-8")
    print(f"完了: 差分のあるページ {len(blocks)} / レポート: {out}")


if __name__ == "__main__":
    main()
