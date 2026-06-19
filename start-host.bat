@echo off
REM CodeRelay Host startup script (Windows)

echo Starting CodeRelay Host...
echo.

REM Set environment variables
set AUTH_TOKEN=test-token-123456
set PORT=3002
set CLAUDE_PROJECTS_DIR=%USERPROFILE%\.claude\projects
set PERMISSION_MODE=default
if "%P2P_SIGNAL_URL%"=="" set P2P_SIGNAL_URL=ws://127.0.0.1:8787/
if "%P2P_HOST_ID%"=="" set P2P_HOST_ID=coderelay-local-host
if "%P2P_WEB_URL%"=="" set P2P_WEB_URL=http://127.0.0.1:3000
if "%P2P_ICE_LOCAL_ADDRESS%"=="" set P2P_ICE_LOCAL_ADDRESS=127.0.0.1
if "%P2P_STATE_FILE%"=="" set P2P_STATE_FILE=%USERPROFILE%\.coderelay\p2p-host-state.json

echo Configuration:
echo   Port: %PORT%
echo   Auth Token: %AUTH_TOKEN%
echo   Projects Dir: %CLAUDE_PROJECTS_DIR%
echo   CodeRelay Signal: %P2P_SIGNAL_URL%
echo   P2P Host ID: %P2P_HOST_ID%
echo   P2P Web URL: %P2P_WEB_URL%
echo   P2P ICE Local Address: %P2P_ICE_LOCAL_ADDRESS%
echo   P2P State File: %P2P_STATE_FILE%
echo.

REM Start service
npm run dev:host
