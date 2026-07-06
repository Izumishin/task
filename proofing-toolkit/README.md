# proofing-toolkit — 紀要組版の赤字反映を効率化するツール一式

手書き赤字のスキャンPDFで戻ってくる著者校正を、

1. **AIで「修正指示リスト」(CSV)に変換** し(`prompts/`)、
2. 単純な置換は **InDesignスクリプトで一括適用** し(`tools/apply_corrections.jsx`)、
3. 修正後PDFとリストを **自動突合して反映漏れを検出** する(`tools/verify_corrections.py`)

ことで、「InDesignでの修正作業」と「反映確認の全件目視」を大幅に圧縮するためのツールキットです。

- **まず読む: 手修正+自動チェックの最小構成** → [`docs/クイックスタート_反映チェック.md`](docs/クイックスタート_反映チェック.md)
- ワークフロー全体の説明 → [`docs/改善提案書.md`](docs/改善提案書.md)
- セットアップと毎号の手順 → [`docs/README_使い方.md`](docs/README_使い方.md)
- 実物の初校から起こしたリストの実例 → [`sample/`](sample/)
