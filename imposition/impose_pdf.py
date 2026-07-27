#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PDF を N面付けする（InDesign 不要 / PDF → PDF）。

InDesign を開かずに、書き出し済みの PDF をそのまま面付けしたいとき用。
1ページ = 1レコードの PDF を、指定グリッド（既定 4列×2行 = 8面）に並べた
シートの PDF を出力する。

出力ページの構造（`はがき面付け.jsx` と同じ）:

    ┌─────────────────────────────┐ ← メディアボックス（印刷可能領域の外周）
    │      ← 印刷可能領域（スラグ） 10mm →      │   ここに断ちトンボを描く
    │   ┌───────────────────────┐   │ ← 裁ち落としボックス
    │   │   ← 裁ち落とし 3mm →   │   │
    │   │   ┌───────────────┐   │   │ ← トリムボックス = 面付けサイズ
    │   │   │  4列 × 2行 の面付け  │   │   │
    │   │   └───────────────┘   │   │
    │   └───────────────────────┘   │
    └─────────────────────────────┘

断ちトンボの本数:
    外周     … 仕上がり線＋塗り足し線の 2 本（日本式の角トンボ）
    面間ドブ … 3 本（両側の仕上がり線＋その中間。ドブ 6mm なら 3mm＋3mm）
    ドブ 0   … 1 本（両側の仕上がり線が重なるため）

必要なもの:  pip install pypdf

例:
    # はがきを 4列×2行、ドブ6mm、裁ち落とし3mm、印刷可能領域10mm、トンボ付き
    python3 impose_pdf.py in.pdf out.pdf --gap-x 6 --gap-y 6 --marks

    # 突き合わせ（ドブなし）でトンボ1本
    python3 impose_pdf.py in.pdf out.pdf --marks

    # 刷版サイズを指定して中央配置
    python3 impose_pdf.py in.pdf out.pdf --sheet 545x394 --gap-x 6 --gap-y 6 --marks
"""

from __future__ import annotations

import argparse
import sys

MM = 72.0 / 25.4  # 1mm を PostScript ポイントに


def mm(v: float) -> float:
    return v * MM


def parse_size(text: str) -> tuple[float, float]:
    """'545x394' 形式（mm）を (幅, 高さ) のポイント値にする。"""
    parts = text.lower().replace("×", "x").replace("*", "x").split("x")
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


def mark_positions(start: float, count: int, size: float, gap: float, bleed: float) -> list[float]:
    """断ちトンボを引く座標を1軸ぶん返す。

    外周は仕上がり線と塗り足し線の2本、面間のドブは3本（ドブ0なら1本）。
    """
    out: list[float] = []

    def push(v: float) -> None:
        if not any(abs(v - x) < 0.01 for x in out):
            out.append(v)

    push(start)
    if bleed > 0:
        push(start - bleed)

    for i in range(count - 1):
        a = start + i * (size + gap) + size   # 手前の面の仕上がり線
        push(a)
        if gap > 0:
            push(a + gap / 2)                 # ドブの中央（3mm＋3mm の境目）
            push(a + gap)                     # 次の面の仕上がり線

    end = start + count * size + (count - 1) * gap
    push(end)
    if bleed > 0:
        push(end + bleed)

    return sorted(out)


def marks_stream(geo: dict, length: float, weight: float) -> str:
    """トンボの content stream を組み立てる（PDF 座標系 = 原点左下）。"""
    ops = ["q", "1 1 1 1 K", f"{weight:.3f} w", "1 J"]
    left, right = geo["left"], geo["right"]
    bottom, top = geo["bottom"], geo["top"]
    b = geo["bleed"]

    for x in mark_positions(left, geo["cols"], geo["card_w"], geo["gap_x"], b):
        ops.append(f"{x:.3f} {top + b:.3f} m {x:.3f} {top + b + length:.3f} l S")
        ops.append(f"{x:.3f} {bottom - b:.3f} m {x:.3f} {bottom - b - length:.3f} l S")
    for y in mark_positions(bottom, geo["rows"], geo["card_h"], geo["gap_y"], b):
        ops.append(f"{left - b:.3f} {y:.3f} m {left - b - length:.3f} {y:.3f} l S")
        ops.append(f"{right + b:.3f} {y:.3f} m {right + b + length:.3f} {y:.3f} l S")

    ops.append("Q")
    return "\n".join(ops)


def build_geometry(args, card_w: float, card_h: float) -> dict:
    grid_w = args.cols * card_w + (args.cols - 1) * mm(args.gap_x)
    grid_h = args.rows * card_h + (args.rows - 1) * mm(args.gap_y)
    bleed = mm(args.bleed)
    slug = mm(args.slug)
    outer = bleed + slug          # トリムボックスからメディアボックスまでの距離

    if args.sheet:
        trim_w, trim_h = args.sheet
        if grid_w > trim_w + 0.01 or grid_h > trim_h + 0.01:
            sys.exit(
                f"エラー: 面付けサイズ {grid_w / MM:.1f}×{grid_h / MM:.1f}mm が "
                f"用紙 {trim_w / MM:.1f}×{trim_h / MM:.1f}mm を超えています。"
            )
    else:
        trim_w, trim_h = grid_w, grid_h

    left = outer + (trim_w - grid_w) / 2
    bottom = outer + (trim_h - grid_h) / 2

    return {
        "media_w": trim_w + outer * 2, "media_h": trim_h + outer * 2,
        "trim_w": trim_w, "trim_h": trim_h,
        "grid_w": grid_w, "grid_h": grid_h,
        "left": left, "right": left + grid_w,
        "bottom": bottom, "top": bottom + grid_h,
        "outer": outer, "bleed": bleed, "slug": slug,
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
    p.add_argument("--bleed", type=float, default=3.0, help="全体の裁ち落とし mm（既定 3）")
    p.add_argument("--slug", type=float, default=10.0, help="印刷可能領域 mm（既定 10）")
    p.add_argument("--sheet", type=parse_size, default=None,
                   help="面付けを載せる用紙サイズ 幅x高さ mm（例 545x394）。省略時は面付けサイズぴったり")
    p.add_argument("--order", choices=["sequential", "cutstack"], default="sequential",
                   help="面付け順（既定 sequential）")
    p.add_argument("--marks", action="store_true", help="断ちトンボを描画する")
    p.add_argument("--mark-length", type=float, default=5.0, help="トンボ長さ mm（既定 5）")
    p.add_argument("--box", choices=["trim", "bleed", "media"], default="trim",
                   help="配置基準のボックス（既定 trim）")
    args = p.parse_args()

    try:
        from pypdf import PageObject, PdfReader, PdfWriter, Transformation
        from pypdf.generic import ArrayObject, DecodedStreamObject, FloatObject, NameObject
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

    if args.marks and mm(args.mark_length) > geo["slug"] + 0.01:
        sys.exit(
            f"エラー: トンボ長さ {args.mark_length}mm が印刷可能領域 {args.slug}mm を超えています。"
        )

    writer = PdfWriter()
    placed = 0

    for s in range(sheets):
        page = PageObject.create_blank_page(width=geo["media_w"], height=geo["media_h"])

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
                marks_stream(geo, mm(args.mark_length), 0.283).encode("latin-1")
            )
            marks_page = PageObject.create_blank_page(width=geo["media_w"], height=geo["media_h"])
            marks_page[NameObject("/Contents")] = stream
            page.merge_page(marks_page)

        def rect(inset: float) -> ArrayObject:
            return ArrayObject([
                FloatObject(geo["outer"] - inset),
                FloatObject(geo["outer"] - inset),
                FloatObject(geo["outer"] + geo["trim_w"] + inset),
                FloatObject(geo["outer"] + geo["trim_h"] + inset),
            ])

        page[NameObject("/TrimBox")] = rect(0)
        page[NameObject("/BleedBox")] = rect(geo["bleed"])
        writer.add_page(page)

    with open(args.output, "wb") as fh:
        writer.write(fh)

    print(
        f"完了: {args.output}\n"
        f"  メディアボックス: {geo['media_w'] / MM:.1f} × {geo['media_h'] / MM:.1f} mm\n"
        f"  トリムボックス　: {geo['trim_w'] / MM:.1f} × {geo['trim_h'] / MM:.1f} mm（面付けサイズ）\n"
        f"  裁ち落とし　　　: {args.bleed} mm / 印刷可能領域: {args.slug} mm\n"
        f"  1面のサイズ　　 : {card_w / MM:.1f} × {card_h / MM:.1f} mm（ドブ 横{args.gap_x} 縦{args.gap_y} mm）\n"
        f"  面付け　　　　　: {args.cols}列 × {args.rows}行 = {per_sheet}面 / {args.order}\n"
        f"  入力　　　　　　: {total} ページ → 出力 {sheets} シート"
        f"（配置 {placed} 面 / 空き {sheets * per_sheet - placed} 面）"
    )


if __name__ == "__main__":
    main()
