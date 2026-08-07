@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   考研错题本 · 本地服务启动
echo   数据存储：mistake-book.db（SQLite）
echo ============================================
start "考研错题本-本地服务" cmd /k "cd /d %~dp0 && node server.js"
timeout /t 2 /nobreak >nul
start http://127.0.0.1:8788
echo 已打开浏览器（http://127.0.0.1:8788）
echo 关闭弹出的「本地服务」窗口即可停止服务
pause
