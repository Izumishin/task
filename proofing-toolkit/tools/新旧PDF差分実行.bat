@echo off
rem 修正前PDFと修正後PDFを選んでテキスト差分レポートを作成します
cd /d "%~dp0"
py pdf_text_diff.py
if errorlevel 1 pause
