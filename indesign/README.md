# 紀要論文 自動組版スクリプト（InDesign / ExtendScript）

Word原稿を配置したストーリーに、見出し・本文・注・図表・参考文献の段落スタイルを一括適用し、根拠の弱い箇所を要確認リストで返すスクリプト。仕様は「紀要論文 自動組版スクリプト 仕様書（2026-09-18）」に従う。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `kiyo_layout.jsx` | スクリプト本体（UTF-8 BOM付き） |
| `style_map.csv` | マッピング表（キー,スタイル名）。冊子ごとに差し替える |

## 使い方

1. 前回号の .indd からスタイルを読み込んだ器（新規ドキュメント）に、Word原稿を配置する
2. `kiyo_layout.jsx` と `style_map.csv` を同じフォルダに置く（InDesign の Scripts Panel フォルダなど）
3. 本文のテキストフレームを選択するか、本文中にカーソルを置く
4. スクリプトを実行する
5. 完了レポートを確認し、「テキスト保存…」で要確認リストを保存する（既定の保存先はドキュメントと同じフォルダ、`<ドキュメント名>_要確認.txt`）

書き換えは1回のアンドゥ（「紀要論文 自動組版」）で元に戻せる。

## マッピング表 CSV

- 2列 `キー,スタイル名`。`#` で始まる行はコメント。UTF-8 / Shift_JIS どちらでも読める
- 必須キー（段落）: `h1 h2 h3 body quote note_head note ref_head ref caption ack`
- 必須キー（文字）: `gothic sup`
- 任意キー: `h4`, `h5` … 見出しが4段階以上ある冊子だけ追加する。無いレベルが出た場合は `h3` に寄せて要確認に出す
- 必須キーが欠けている、またはCSVの名前がドキュメントに無い場合は、書き換えを始める前に停止して一覧を表示する。スタイルグループの中も検索対象

## 現在の実装範囲（第1段階）

実装済み:

- `CFG` に設定を集約（CSVファイル名、必須キー、太字判定のフォントスタイル名パターン、要確認に出す文字の種類、レポート設定）
- CSV読み込み（`readTextFile` / `parseCSV`）、スタイル解決（`scanStyles` / `getStyle`、スタイルグループ対応）、不足スタイルの一覧表示
- 全段落の情報採取（`collectParagraphs`）: 文字サイズ（最大・最小・最頻値）、太字（全体／一部）、先頭文字列、文字数、上付きの有無、斜体・下線・取り消し線、行頭行末の空白、句点終わり、前後のアキ、強制改行・表・脚注・アンカーの有無、外字・□ の有無
- 判定結果（`results`）を受け取って段落スタイルを当てる処理（`applyParagraphStyles`）。`UndoModes.ENTIRE_SCRIPT` の中で実行
- 要確認リストの表示とテキスト保存（`showReport`）。段落番号は `G.indexMap` を通して実行後の番号で出す
- 工程名（`STEP`）の管理と、個別失敗を止めずに集める失敗リスト

TODO（第2段階、関数の枠と入出力のみ）:

| 関数 | 入力 | 出力 |
| --- | --- | --- |
| `detectHeadingCandidates(infos, stats)` | 段落情報、論文全体の統計 | 見出し候補の段落index配列 |
| `assignHeadingLevels(candidates, infos, stats, results)` | 候補、段落情報、統計 | `results[i].kind` を `h1`… に書き換え。層と番号体系が食い違えば `check`、収まらなければ `body` + `check` |
| `detectNoteSection(infos, stats, results)` | 同上 | `note_head` / `note` |
| `detectRefSection(infos, stats, results)` | 同上 | `ref_head` / `ref` |
| `detectCaptions(infos, stats, results)` | 同上 | `caption` |
| `detectAck(infos, stats, results)` | 同上 | `ack`（参考文献の後ろなら `check`） |
| `stripLeadingSpaces()` | `G` | 行頭スペースの削除 |
| `applyNoteSuperscript()` | `G` | 本文中の注番号に `sup` |
| `applyGothic()` | `G` | 部分太字に `gothic` |
| `clearOverrides()` | `G` | 直接書式のリセット |
| `cleanupWordArtifacts()` | `G` | 空段落削除など。削除したら `G.indexMap` を更新 |
| `postCheck()` のオーバーセット検出 | `G` | 要確認に追加 |

判定が未実装のため、現状は全段落が「未判定」となりスタイルは当たらない（レポートの「未判定（スタイル未適用）」に件数が出る）。機械的なチェック（外字・□・強制改行・斜体・下線・取り消し線・全体太字・「標準」のまま残った段落）は動く。

### `results[i]` の形

```
{ kind: "h1" | "h2" | ... | "body" | "quote" | "note_head" | "note" |
        "ref_head" | "ref" | "caption" | "ack" | null,   // null = 未判定
  reason: "判定理由",   // 要確認リストに出す
  check: true/false,    // 要確認に出す
  skip: true/false }    // スタイルを当てない（空段落）
```

`kind` の文字列は CSV のキーと同じ。`makeResult(kind, reason, check, skip)` で作る。

## 実装ルール（仕様書より）

1. DOM参照を跨いで保持しない。index で指し、毎回取り直す
2. `app.doScript()` の中で使う変数は、すべて doScript より前で初期化する（`G` / `CFG`）
3. スタイル検索は `allParagraphStyles` / `allCharacterStyles` を走査する
4. ページアイテムの走査は `allPageItems` も見る
5. 採取はドキュメントを書き換える前に行い、数値として控える
6. 工程名の変数を持ち、例外時に止まった工程を表示する
7. `UndoModes.ENTIRE_SCRIPT` で1回のアンドゥで全部戻せるようにする
8. 個別の項目で失敗しても全体を止めず、失敗リストを出して最後まで走る
9. 設定は `CFG` に集約する
10. 段落の削除・追加は後ろから前に向かって処理する

ES3 の制約: `let` / `const` / アロー関数 / `JSON` / テンプレートリテラル / `String.trim` / 配列の `indexOf` は使わない。
