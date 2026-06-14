@echo off
REM 前端启动脚本 (Windows)

echo Starting CC-Web Frontend...
echo.
echo Frontend will be available at: http://localhost:3000
echo Backend API: http://localhost:3002
echo Auth Token: test-token-123
echo.

npm run dev:web
