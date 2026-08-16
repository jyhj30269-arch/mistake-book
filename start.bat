@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   个人工作台 · 本地服务启动
echo   数据存储：mistake-book.db（SQLite）
echo   如需自定义端口/地址：set PORT=8788 ^&^& set HOST=127.0.0.1
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node 命令，请安装 Node.js 或将其加入 PATH。
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=8788
if "%HOST%"=="" set HOST=127.0.0.1
start "个人工作台-本地服务" /D "%~dp0" node server.js
timeout /t 2 /nobreak >nul
start "" "http://%HOST%:%PORT%"
echo 已打开浏览器（http://%HOST%:%PORT%）
echo 关闭弹出的「个人工作台-本地服务」窗口即可停止服务
exit /b 0
