@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 启动商机拆表工具...
echo 访问地址: http://localhost:5556
echo.
python app.py
pause
