@echo off
REM Backend startup script (Windows)

echo Starting CC-Web Server...
echo.

REM Set environment variables
set AUTH_TOKEN=test-token-123456
set PORT=3002
set CLAUDE_PROJECTS_DIR=%USERPROFILE%\.claude\projects
set PERMISSION_MODE=default

echo Configuration:
echo   Port: %PORT%
echo   Auth Token: %AUTH_TOKEN%
echo   Projects Dir: %CLAUDE_PROJECTS_DIR%
echo.

REM Start service
npm run dev:server
