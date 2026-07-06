@echo off
rem Acrobatから書き出した注釈(XFDF)を修正指示リストCSVに変換します
cd /d "%~dp0"
py xfdf_to_list.py
if errorlevel 1 pause
