#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PDF を N面付けする（InDesign 不要 / PDF → PDF）。

InDesign を開かずに、書き出し済みの PDF をそのまま面付けしたいとき用。
1ページ = 1レコードの PDF を、指定グリッド（既定 4列×2行 = 8面）に並べた
シートの PDF を出力する。

必要なもの:  pip install pypdf

例:
    # はがき（100×148mm）を 4列×2行、断裁積み、トンボ付きで面付け
    python3 impose_pdf.py in.pdf out.pdf --cols 4 --rows 2 \
        --order cutstack --sheet 545x394 --marks

    # 用紙サイズ指定なし（面付けサイズ＋余白10mm で自動）
    python3 impose_pdf.py in.pdf out.pdf --margin 10 --marks
"""

from __future__ import annotations

import argparse
import sys

MM = 72.0 / 25.4  # 1mm を PostScript ポイントに


def mm(v: float) -> float:
    return v * MM


def parse_size(text: str) -> tuple[float, float]:
    """'545x394' 形式（mm）を (幅, 高さ) のポイント値にする。"""
    sep = "x" if "x" in text.lower() else "*"
    parts = text.lower().replace("×", "x").split(sep)
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f"サイズは 幅x高さ (mm) で指定してください: {text}")
    return mm(float(parts[0])), mm(float(parts[1]))


def slot_to_index(sheet: int, slot: int, sheets: int, per_sheet: int, order: str) -> int:
    """面の位置から、元 PDF の 0 始まりページ番号を返す。

    sequential : シート1 = 1〜8, シート2 = 9〜16 …
    cutstack   : 面1 に 1〜(シート数), 面2 にその続き …
                 断裁後に各山を上から重ねると通し順に戻る。
    """
    if order == "cutstack":
        return slot * sheets + sheet
    return sheet * per_sheet + slot


def cut_positions(start: float, count: int, size: float, gap: float) -> list[float]:
    out: list[float] = []
    for i in range(count):
        a = start + i * (size + gap)
        for v in (a, a + size):
            if not any(abs(v - x) < 0.01 for x in out):
                out.append(v)
    return out


def marks_stream(geo: dict, length: float, offset: float, weight: float) -> str:
    """トンボ（断裁位置マーク）の content stream を組み立てる。"""
    ops = ["q", "1 1 1 1 K", f"{weight:.3f} w"]
    left, right = geo["left"], geo["right"]
    bottom, top = geo["bottom"], geo["top"]  # PDF 座標系 = 原点左下

    for x in cut_positions(left, geo["cols"], geo["card_w"], geo["gap_x"]):
        ops.append(f"{x:.3f} {top + offset:.3f} m {x:.3f} {top + offset + length:.3f} l S")
        ops.append(f"{x:.3f} {bottom - offset:.3f} m {x:.3f} {bottom - offset - length:.3f} l S")
    for y in cut_positions(bottom, geo["rows"], geo["card_h"], geo["gap_y"]):
        ops.append(f"{left - offset:.3f} {y:.3f} m {left - offset - length:.3f} {y:.3f} l S")
        ops.append(f"{right + offset:.3f} {y:.3f} m {right + offset + length:.3f} {y:.3f} l S")

    ops.append("Q")
    return "\n".join(ops)


def build_geometry(args, card_w: float, card_h: float) -> dict:
    grid_w = args.cols * card_w + (args.cols - 1) * mm(args.gap_x)
    grid_h = args.rows * card_h + (args.rows - 1) * mm(args.gap_y)

    if args.sheet:
        sheet_w, sheet_h = args.sheet
        if grid_w > sheet_w + 0.01 or grid_h > sheet_h + 0.01:
            sys.exit(
                f"エラー: 面付けサイズ {grid_w / MM:.1f}×{grid_h / MM:.1f}mm が "
                f"用紙 {sheet_w / MM:.1f}×{sheet_h / MM:.1f}mm を超えています。"
            )
        left = (sheet_w - grid_w) / 2
        bottom = (sheet_h - grid_h) / 2
    else:
        margin = mm(args.margin)
        sheet_w, sheet_h = grid_w + margin * 2, grid_h + margin * 2
        left = bottom = margin

    return {
        "sheet_w": sheet_w, "sheet_h": sheet_h,
        "grid_w": grid_w, "grid_h": grid_h,
        "left": left, "right": left + grid_w,
        "bottom": bottom, "top": bottom + grid_h,
        "cols": args.cols, "rows": args.rows,
        "card_w": card_w, "card_h": card_h,
        "gap_x": mm(args.gap_x), "gap_y": mm(args.gap_y),
    }


def main() -> None:
    p = argparse.ArgumentParser(description="PDF を N面付けする")
    p.add_argument("input", help="1ページ = 1レコードの PDF")
    p.add_argument("output", help="出力する面付け済み PDF")
    p.add_argument("--cols", type=int, default=4, help="列数（既定 4）")
    p.add_argument("--rows", type=int, default=2, help="行数（既定 2）")
    p.add_argument("--gap-x", type=float, default=0.0, help="面間の横アキ mm（既定 0）")
    p.add_argument("--gap-y", type=float, default=0.0, help="面間の縦アキ mm（既定 0）")
    p.add_argument("--sheet", type=parse_size, default=None,
                   help="用紙サイズ 幅x高さ mm（例 545x394）。省略時は面付けサイズ＋余白")
    p.add_argument("--margin", type=float, default=10.0, help="--sheet 省略時の余白 mm（既定 10）")
    p.add_argument("--order", choices=["sequential", "cutstack"], default="sequential",
                   help="面付け順（既定 sequential）")
    p.add_argument("--marks", action="store_true", help="トンボを描画する")
    p.add_argument("--mark-length", type=float, default=5.0, help="トンボ長さ mm（既定 5）")
    p.add_argument("--mark-offset", type=float, default=1.0, help="トンボのオフセット mm（既定 1）")
    p.add_argument("--box", choices=["trim", "bleed", "media"], default="trim",
                   help="配置基準のボックス（既定 trim）")
    args = p.parse_args()

    try:
        from pypdf import PageObject, PdfReader, PdfWriter, Transformation
        from pypdf.generic import DecodedStreamObject, NameObject
    except ImportError:
        sys.exit("pypdf が必要です:  pip install pypdf")

    reader = PdfReader(args.input)
    total = len(reader.pages)
    if total == 0:
        sys.exit("エラー: 入力 PDF にページがありません。")

    box_attr = {"trim": "trimbox", "bleed": "bleedbox", "media": "mediabox"}[args.box]
    first = getattr(reader.pages[0], box_attr)
    card_w = float(first.width)
    card_h = float(first.height)

    geo = build_geometry(args, card_w, card_h)
    per_sheet = args.cols * args.rows
    sheets = -(-total // per_sheet)  # 切り上げ

    if args.marks:
        need = mm(args.mark_length + args.mark_offset)
        if min(geo["left"], geo["bottom"]) < need:
            sys.exit(
                f"エラー: トンボ用の余白が足りません（各辺 {need / MM:.1f}mm 以上必要）。"
            )

    writer = PdfWriter()
    placed = 0

    for s in range(sheets):
        page = PageObject.create_blank_page(width=geo["sheet_w"], height=geo["sheet_h"])

        for slot in range(per_sheet):
            idx = slot_to_index(s, slot, sheets, per_sheet, args.order)
            if not 0 <= idx < total:
                continue

            src = reader.pages[idx]
            box = getattr(src, box_attr)
            col = slot % args.cols
            row = slot // args.cols

            # 面付けは左上から右下へ数える。PDF 座標は左下原点なので行を反転する。
            tx = geo["left"] + col * (geo["card_w"] + geo["gap_x"]) - float(box.left)
            ty = geo["top"] - (row + 1) * geo["card_h"] - row * geo["gap_y"] - float(box.bottom)

            page.merge_transformed_page(src, Transformation().translate(tx, ty))
            placed += 1

        if args.marks:
            stream = DecodedStreamObject()
            stream.set_data(
                marks_stream(geo, mm(args.mark_length), mm(args.mark_offset), 0.283).encode("latin-1")
            )
            marks_page = PageObject.create_blank_page(width=geo["sheet_w"], height=geo["sheet_h"])
            marks_page[NameObject("/Contents")] = stream
            page.merge_page(marks_page)

        writer.add_page(page)

    with open(args.output, "wb") as fh:
        writer.write(fh)

    print(
        f"完了: {args.output}\n"
        f"  用紙　　　: {geo['sheet_w'] / MM:.1f} × {geo['sheet_h'] / MM:.1f} mm\n"
        f"  仕上りサイズ: {card_w / MM:.1f} × {card_h / MM:.1f} mm\n"
        f"  面付け　　: {args.cols}列 × {args.rows}行 = {per_sheet}面 / {args.order}\n"
        f"  入力　　　: {total} ページ → 出力 {sheets} シート（配置 {placed} 面 / 空き {sheets * per_sheet - placed} 面）"
    )


if __name__ == "__main__":
    main()
