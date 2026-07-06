@echo off
rem 修正指示リスト(CSV)と修正後PDFを選んで反映チェックを実行します
cd /d "%~dp0"
py verify_corrections.py
if errorlevel 1 pause
