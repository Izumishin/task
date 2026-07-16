@echo off
rem 名刺データ管理台帳 起動スクリプト(Windows用)
rem このファイルをダブルクリックするとアプリが起動します。
cd /d "%~dp0"
chcp 65001 >nul

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js がインストールされていません。
  echo https://nodejs.org から LTS 版をインストールしてから、もう一度実行してください。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 初回準備中です(1〜2分かかります)...
  call npm install
  if errorlevel 1 (
    echo 準備に失敗しました。ネット接続を確認してください。
    pause
    exit /b 1
  )
)

echo.
echo ================================================
echo  名刺データ管理台帳を起動します
echo  ブラウザで http://localhost:3000 を開いてください
echo  このウインドウは閉じずに最小化しておいてください
echo  (閉じるとアプリが止まります)
echo ================================================
echo.
call npm start
pause
