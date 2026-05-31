@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   在线Excel表格管理工具
echo   访问地址: http://localhost:5558
echo ========================================
python app.py
pause
