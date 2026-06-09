# タスク管理アプリ

シンプルなタスク管理Webアプリ。天気ウィジェットと両学長の応援メッセージ付き。

## 機能

- タスクの追加・完了・編集（ダブルクリック）・削除
- フィルタ表示（すべて / 未完了 / 完了済み）
- 現在地の天気表示（[wttr.in](https://wttr.in) を利用、位置情報の許可が必要）
- 両学長の応援メッセージ（タップで切り替え）

## 起動方法

```bash
npm install
npm start
```

ブラウザで http://localhost:3000 を開く。

ポートを変えたい場合は環境変数 `PORT` を指定する。

```bash
PORT=8080 npm start
```

## 構成

| ファイル | 役割 |
|---|---|
| `server.js` | Express製のREST API（タスクのCRUD） |
| `public/index.html` | 画面（HTML / CSS / JS すべて込み） |
| `tasks.json` | タスクデータの保存先（自動生成、gitignore済み) |

## API

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/tasks` | タスク一覧を取得 |
| POST | `/api/tasks` | タスクを追加（`{ "title": "..." }`） |
| PATCH | `/api/tasks/:id` | タスクを更新（`title` / `done`） |
| DELETE | `/api/tasks/:id` | タスクを削除 |

## データ保存

データベースは使わず、`tasks.json` にJSONファイルとして保存している。
サーバーを再起動してもデータは残る。リセットしたい場合は `tasks.json` を削除する。
