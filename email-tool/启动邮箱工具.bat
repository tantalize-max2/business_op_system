@echo off
chcp 65001 >nul
echo ===================================================
echo   邮箱工具 启动
echo ===================================================
echo.
echo 正在启动服务...
echo 启动后请在浏览器中访问: http://localhost:5555
echo 按 Ctrl+C 可停止服务
echo.
cd /d "%~dp0"
python app.py
pause
