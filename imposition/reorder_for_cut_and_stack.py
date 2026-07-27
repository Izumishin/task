#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""データ結合の「複数レコードレイアウト」用に CSV を断裁積み順へ並べ替える。

InDesign の複数レコードレイアウトは必ず「順並び」でレコードを流し込むため、
断裁後に通し順へ戻したい場合は、あらかじめ CSV 側を並べ替えておく必要がある。

例:  3000件 / 8面付け → 375シート
     並べ替え後の CSV を順に流し込むと、
       シート1 = 元レコード 1, 376, 751, 1126, 1501, 1876, 2251, 2626
     となり、断裁後に面1→面8 の山を上から重ねると 1〜3000 の通し順になる。

使い方:
    python3 reorder_for_cut_and_stack.py in.csv out.csv --per-sheet 8
    python3 reorder_for_cut_and_stack.py in.csv out.csv --cols 4 --rows 2 --encoding cp932
"""

from __future__ import annotations

import argparse
import csv
import sys


def main() -> None:
    p = argparse.ArgumentParser(description="CSV を断裁積み（カット&スタック）順に並べ替える")
    p.add_argument("input", help="入力 CSV（1行目はヘッダー）")
    p.add_argument("output", help="出力 CSV")
    p.add_argument("--per-sheet", type=int, default=None, help="1シートの面数（既定 8）")
    p.add_argument("--cols", type=int, default=4, help="列数（--per-sheet 未指定時に使用）")
    p.add_argument("--rows", type=int, default=2, help="行数（--per-sheet 未指定時に使用）")
    p.add_argument("--encoding", default="utf-8-sig",
                   help="入出力の文字コード（Excel 由来なら cp932。既定 utf-8-sig）")
    p.add_argument("--pad", action="store_true",
                   help="端数を空行で埋めてシートを完全に満たす")
    args = p.parse_args()

    per_sheet = args.per_sheet if args.per_sheet else args.cols * args.rows
    if per_sheet < 1:
        sys.exit("エラー: 面数は 1 以上にしてください。")

    with open(args.input, newline="", encoding=args.encoding) as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            sys.exit("エラー: 入力 CSV が空です。")
        rows = [r for r in reader if any(cell.strip() for cell in r)]

    total = len(rows)
    if total == 0:
        sys.exit("エラー: データ行がありません。")

    sheets = -(-total // per_sheet)  # 切り上げ
    blank = [""] * len(header)

    # 面 slot に レコード slot*sheets 〜 (slot+1)*sheets-1 を割り当て、
    # シート順（= 流し込み順）に読み出す。
    out: list[list[str]] = []
    padded = 0
    for sheet in range(sheets):
        for slot in range(per_sheet):
            idx = slot * sheets + sheet
            if idx < total:
                out.append(rows[idx])
            elif args.pad:
                out.append(blank)
                padded += 1

    with open(args.output, "w", newline="", encoding=args.encoding) as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(out)

    print(
        f"完了: {args.output}\n"
        f"  レコード数: {total} → 出力 {len(out)} 行"
        + (f"（空行 {padded} 行を追加）" if padded else "")
        + f"\n  面付け　　: {per_sheet}面 / {sheets} シート\n"
        f"  この CSV を複数レコードレイアウトで順に流し込むと、断裁後の積み重ねで通し順になります。"
    )


if __name__ == "__main__":
    main()
