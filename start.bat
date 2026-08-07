@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   考研错题本 · 本地服务启动
echo   数据存储：mistake-book.db（SQLite）
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node 命令，请安装 Node.js 或将其加入 PATH。
  pause
  exit /b 1
)
start "考研错题本-本地服务" /D "%~dp0" node server.js
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8788"
echo 已打开浏览器（http://127.0.0.1:8788）
echo 关闭弹出的「考研错题本-本地服务」窗口即可停止服务
exit /b 0
