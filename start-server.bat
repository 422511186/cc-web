@echo off
REM 后端启动脚本 (Windows)

echo Starting CC-Web Server...
echo.

REM 设置环境变量
set AUTH_TOKEN=test-token-123
set PORT=3002
set CLAUDE_PROJECTS_DIR=%USERPROFILE%\.claude\projects
set PERMISSION_MODE=default

echo Configuration:
echo   Port: %PORT%
echo   Auth Token: %AUTH_TOKEN%
echo   Projects Dir: %CLAUDE_PROJECTS_DIR%
echo.

REM 启动服务
npm run dev:server
