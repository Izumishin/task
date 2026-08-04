# tools

## split_sheets_to_pdf.py

Excel ブックの各シートを、シートごとに別々の PDF ファイルへ書き出します。

### 準備

```bash
sudo apt-get install libreoffice-calc python3-uno
```

### 使い方

```bash
# 全シートを book_pdf/ に出力
python3 tools/split_sheets_to_pdf.py 見積書.xlsx

# 出力先を指定
python3 tools/split_sheets_to_pdf.py 見積書.xlsx ./pdf

# 特定のシートだけ
python3 tools/split_sheets_to_pdf.py 見積書.xlsx ./pdf 4月明細 5月明細
```

出力は `01_シート名.pdf` のようにブック内の並び順で連番が付きます。

### 仕様メモ

- LibreOffice をヘッドレスで起動し UNO 経由で PDF 出力するため、セル書式・
  結合セル・図形・グラフ・印刷範囲などは元ファイルのまま保持されます。
- PDF 出力時に対象シートを `Selection` として渡しているので、1 ファイルに
  1 シートだけが入ります（内容が印刷範囲に収まらない場合はそのシート内で
  複数ページになります）。
- 非表示シートは既定で対象外です。名前を明示的に指定すれば出力できます。
- `.xlsx` / `.xlsm` / `.xls` / `.ods` に対応しています。
