#!/usr/bin/env python3
"""Excel ブックの各シートを 1 枚ずつ別々の PDF に書き出す。

使い方:
    python3 tools/split_sheets_to_pdf.py book.xlsx [出力先ディレクトリ] [シート名 ...]

  - 出力先を省略すると book_pdf/ を元ファイルと同じ場所に作る
  - シート名を並べるとそのシートだけを出力する（省略時は表示中の全シート）

必要なもの: LibreOffice（Calc 込み）と python3-uno
    sudo apt-get install libreoffice-calc python3-uno

LibreOffice をヘッドレスで起動して UNO 経由で操作するため、
書式・図形・グラフ・印刷設定は元ファイルのまま保持される。
"""

import os
import re
import subprocess
import sys
import time
import uno
from com.sun.star.beans import PropertyValue

SOFFICE = "soffice"
PIPE = "split_sheets_pdf_pipe"
# 他の LibreOffice 起動とプロファイルが衝突しないよう専用プロファイルを使う
PROFILE = "file:///tmp/lo_profile_split_sheets"


def prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def connect(timeout=90):
    """soffice をヘッドレス起動して UNO のデスクトップを返す。"""
    subprocess.Popen(
        [
            SOFFICE,
            "--headless",
            "--norestore",
            "--nolockcheck",
            "--nodefault",
            f"-env:UserInstallation={PROFILE}",
            f"--accept=pipe,name={PIPE};urp;",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    local_ctx = uno.getComponentContext()
    resolver = local_ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_ctx
    )
    deadline = time.time() + timeout
    while True:
        try:
            ctx = resolver.resolve(
                f"uno:pipe,name={PIPE};urp;StarOffice.ComponentContext"
            )
            break
        except Exception:
            if time.time() > deadline:
                raise RuntimeError("LibreOffice に接続できませんでした")
            time.sleep(0.5)
    return ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.frame.Desktop", ctx
    )


def safe(name):
    """ファイル名に使えない文字を落とす。"""
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "sheet"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    src = os.path.abspath(sys.argv[1])
    if not os.path.exists(src):
        sys.exit(f"ファイルが見つかりません: {src}")

    if len(sys.argv) > 2:
        outdir = os.path.abspath(sys.argv[2])
    else:
        stem = os.path.splitext(os.path.basename(src))[0]
        outdir = os.path.join(os.path.dirname(src), stem + "_pdf")
    os.makedirs(outdir, exist_ok=True)
    wanted = sys.argv[3:]

    desktop = connect()
    doc = desktop.loadComponentFromURL(
        uno.systemPathToFileUrl(src), "_blank", 0, (prop("Hidden", True),)
    )
    try:
        sheets = doc.Sheets
        names = list(sheets.ElementNames)
        if wanted:
            unknown = [n for n in wanted if n not in names]
            if unknown:
                sys.exit(f"存在しないシート名: {', '.join(unknown)}")
            targets = wanted
        else:
            # 元々非表示のシートは出力対象から外す
            targets = [n for n in names if sheets.getByName(n).IsVisible]
        if not targets:
            sys.exit("出力対象のシートがありません")

        for idx, name in enumerate(targets, 1):
            # 対象シートを Selection として渡すと、そのシートだけが PDF になる
            out = os.path.join(outdir, f"{idx:02d}_{safe(name)}.pdf")
            doc.storeToURL(
                uno.systemPathToFileUrl(out),
                (
                    prop("FilterName", "calc_pdf_Export"),
                    prop("Overwrite", True),
                    prop(
                        "FilterData",
                        uno.Any(
                            "[]com.sun.star.beans.PropertyValue",
                            (prop("Selection", sheets.getByName(name)),),
                        ),
                    ),
                ),
            )
            print(f"  {name} -> {os.path.basename(out)}")
        print(f"\n完了: {len(targets)} 個の PDF を {outdir} に出力しました")
    finally:
        doc.close(False)


if __name__ == "__main__":
    main()
