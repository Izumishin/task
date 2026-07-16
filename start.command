#!/bin/bash
# 名刺データ管理台帳 起動スクリプト(Mac用)
# このファイルをダブルクリックするとアプリが起動します。
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js がインストールされていません。"
  echo "https://nodejs.org から LTS 版をインストールしてから、もう一度実行してください。"
  read -p "Enterキーで閉じます..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "初回準備中です(1〜2分かかります)..."
  npm install || { echo "準備に失敗しました。ネット接続を確認してください。"; read -p "Enterキーで閉じます..."; exit 1; }
fi

echo ""
echo "================================================"
echo " 名刺データ管理台帳を起動します"
echo " ブラウザで http://localhost:3000 を開いてください"
echo " このウインドウは閉じずに最小化しておいてください"
echo " (閉じるとアプリが止まります)"
echo "================================================"
echo ""
npm start
read -p "Enterキーで閉じます..."
