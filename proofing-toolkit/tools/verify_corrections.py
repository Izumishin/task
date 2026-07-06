#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_corrections.py — 修正指示リストと修正後PDFを突合して反映チェックレポートを作る

使い方:
    py verify_corrections.py 修正指示リスト.csv 修正後.pdf
    (引数なしで実行するとファイル選択ダイアログが開きます)

入力CSVの列(テンプレート準拠・1行目はヘッダ):
    No, ページ, アンカー, 指示種別, 修正前, 修正後, 自動置換可, 反映済, 検証結果, 備考

判定ルール:
    置換・挿入 : 「修正後」がそのページ±1の範囲に存在すれば OK。
                 存在してもなお「修正前」が同範囲に残っていれば「要目視」。
    削除       : 「修正前」がそのページ±1の範囲から消えていれば OK。
    体裁・照会 : 文字面では判定できないため常に「要目視」。

出力:
    チェック結果.html (色分きレポート) / チェック結果.csv (検証結果列を埋めたリスト)
"""

import csv
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

CSV_COLUMNS = ["No", "ページ", "アンカー", "指示種別", "修正前", "修正後",
               "自動置換可", "反映済", "検証結果", "備考"]

OK, NG, MANUAL = "OK", "NG", "要目視"


def normalize(s: str) -> str:
    """全半角・合字ゆれをNFKCで揃え、空白類をすべて除去して比較用文字列にする。"""
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    # PDFのテキスト抽出は改行・スペースの入り方が組版依存なので空白は無視して比較する
    return "".join(ch for ch in s if not ch.isspace())


def load_pdf_pages(pdf_path: Path) -> list:
    """PDFをページごとのテキスト(正規化済み)のリストにする。"""
    with open(pdf_path, "rb") as f:
        n_pages = sum(1 for _ in PDFPage.get_pages(f))
    pages = []
    for i in range(n_pages):
        text = extract_text(str(pdf_path), page_numbers=[i]) or ""
        pages.append(normalize(text))
    return pages


def search_window(pages: list, page_no: int, needle: str) -> bool:
    """指定ページ±1の範囲(リフローを考慮)で needle を探す。"""
    if not needle:
        return False
    lo = max(0, page_no - 2)          # page_no は1始まり → index は -1、さらに前後1ページ
    hi = min(len(pages), page_no + 1)
    return any(needle in pages[i] for i in range(lo, hi))


def judge(row: dict, pages: list):
    """1行分を判定して (結果, 理由) を返す。"""
    kind = (row.get("指示種別") or "").strip()
    before = normalize(row.get("修正前") or "")
    after = normalize(row.get("修正後") or "")

    if kind in ("体裁", "照会"):
        return MANUAL, "文字面では判定できない指示のため目視確認してください"

    try:
        page_no = int(unicodedata.normalize("NFKC", str(row.get("ページ", "")).strip()))
    except ValueError:
        return MANUAL, "ページ番号が読み取れないため目視確認してください"

    if page_no < 1 or page_no > len(pages):
        return MANUAL, f"ページ {page_no} がPDF範囲外です(PDFは全{len(pages)}ページ)"

    if kind == "削除":
        if not before:
            return MANUAL, "「修正前」が空のため判定できません"
        if search_window(pages, page_no, before):
            return NG, "削除対象の文字列がまだ残っています"
        return OK, "削除対象の文字列は見つかりません(反映済みと判断)"

    # 置換・挿入(それ以外の種別もここで判定)
    if not after:
        return MANUAL, "「修正後」が空のため判定できません"
    found_after = search_window(pages, page_no, after)
    if not found_after:
        return NG, "「修正後」の文字列がページ±1の範囲に見つかりません"
    if before and before != after and search_window(pages, page_no, before):
        return MANUAL, "「修正後」はありますが「修正前」の文字列も同範囲に残っています(別箇所の同文の可能性あり)"
    if len(after) < 6:
        return OK, "反映を確認(検索文字列が短いため念のため目視推奨)"
    return OK, "反映を確認しました"


def build_html(rows: list, pdf_name: str, csv_name: str) -> str:
    counts = {OK: 0, NG: 0, MANUAL: 0}
    for r in rows:
        counts[r["検証結果"]] = counts.get(r["検証結果"], 0) + 1
    color = {OK: "#e6f4ea", NG: "#fce8e6", MANUAL: "#fef7e0"}
    badge = {OK: "#137333", NG: "#c5221f", MANUAL: "#b06000"}

    body_rows = []
    for r in rows:
        c = color.get(r["検証結果"], "#fff")
        b = badge.get(r["検証結果"], "#333")
        body_rows.append(
            f'<tr style="background:{c}">'
            f'<td>{html.escape(str(r.get("No", "")))}</td>'
            f'<td>{html.escape(str(r.get("ページ", "")))}</td>'
            f'<td><b style="color:{b}">{html.escape(r["検証結果"])}</b></td>'
            f'<td>{html.escape(r.get("指示種別", ""))}</td>'
            f'<td>{html.escape(r.get("修正前", ""))}</td>'
            f'<td>{html.escape(r.get("修正後", ""))}</td>'
            f'<td>{html.escape(r.get("判定理由", ""))}</td>'
            f'<td>{html.escape(r.get("備考", ""))}</td></tr>'
        )
    return f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<title>反映チェック結果</title>
<style>
 body {{ font-family: "Yu Gothic UI", "Meiryo", sans-serif; margin: 24px; }}
 table {{ border-collapse: collapse; width: 100%; font-size: 13px; }}
 th, td {{ border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }}
 th {{ background: #f1f3f4; position: sticky; top: 0; }}
 .sum span {{ display: inline-block; margin-right: 16px; font-weight: bold; }}
</style></head><body>
<h1>反映チェック結果</h1>
<p>修正指示リスト: {html.escape(csv_name)}<br>
修正後PDF: {html.escape(pdf_name)}<br>
実行日時: {datetime.now().strftime("%Y-%m-%d %H:%M")}</p>
<p class="sum">
 <span style="color:#137333">OK: {counts.get(OK, 0)}件</span>
 <span style="color:#c5221f">NG: {counts.get(NG, 0)}件</span>
 <span style="color:#b06000">要目視: {counts.get(MANUAL, 0)}件</span>
 <span>合計: {len(rows)}件</span>
</p>
<p>NG と 要目視 の行だけを赤字原稿と突き合わせれば確認完了です。</p>
<table>
<tr><th>No</th><th>頁</th><th>結果</th><th>種別</th><th>修正前</th><th>修正後</th><th>判定理由</th><th>備考</th></tr>
{''.join(body_rows)}
</table></body></html>"""


def pick_files_gui():
    """引数なし実行時: ファイル選択ダイアログ(Windows想定)。"""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return None, None
    root = tk.Tk()
    root.withdraw()
    csv_path = filedialog.askopenfilename(
        title="修正指示リスト(CSV)を選択", filetypes=[("CSV", "*.csv")])
    if not csv_path:
        return None, None
    pdf_path = filedialog.askopenfilename(
        title="修正後のPDFを選択", filetypes=[("PDF", "*.pdf")])
    root.destroy()
    return csv_path, pdf_path


def main():
    if len(sys.argv) >= 3:
        csv_path, pdf_path = sys.argv[1], sys.argv[2]
    else:
        csv_path, pdf_path = pick_files_gui()
        if not csv_path or not pdf_path:
            print("使い方: py verify_corrections.py 修正指示リスト.csv 修正後.pdf")
            sys.exit(1)

    csv_path, pdf_path = Path(csv_path), Path(pdf_path)
    print(f"PDFを読み込み中: {pdf_path.name} ...")
    pages = load_pdf_pages(pdf_path)
    print(f"  全{len(pages)}ページを読み込みました")

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        rows = [dict(r) for r in csv.DictReader(f)]
    print(f"修正指示 {len(rows)}件を判定中 ...")

    for row in rows:
        result, reason = judge(row, pages)
        row["検証結果"] = result
        row["判定理由"] = reason

    out_dir = csv_path.parent
    html_path = out_dir / "チェック結果.html"
    out_csv_path = out_dir / "チェック結果.csv"

    html_path.write_text(build_html(rows, pdf_path.name, csv_path.name),
                         encoding="utf-8")
    with open(out_csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS + ["判定理由"],
                                extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    counts = {}
    for r in rows:
        counts[r["検証結果"]] = counts.get(r["検証結果"], 0) + 1
    print(f"完了: OK {counts.get(OK, 0)} / NG {counts.get(NG, 0)} / "
          f"要目視 {counts.get(MANUAL, 0)}")
    print(f"レポート: {html_path}")


if __name__ == "__main__":
    main()
