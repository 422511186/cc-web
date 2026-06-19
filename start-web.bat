@echo off
REM CodeRelay Web startup script (Windows)

echo Starting CodeRelay Web...
echo.
if "%PUBLIC_SIGNAL_URL%"=="" if not "%P2P_SIGNAL_URL%"=="" set PUBLIC_SIGNAL_URL=%P2P_SIGNAL_URL%
if "%PUBLIC_SIGNAL_URL%"=="" set PUBLIC_SIGNAL_URL=ws://127.0.0.1:8787/
if "%VITE_CODERELAY_SIGNAL_URL%"=="" set VITE_CODERELAY_SIGNAL_URL=%PUBLIC_SIGNAL_URL%

echo Web UI will be available at: http://localhost:3000
echo Host API: http://localhost:3002
echo Auth Token: test-token-123456
echo CodeRelay Signal: %VITE_CODERELAY_SIGNAL_URL%
echo P2P: 打开 Host 管理页 http://localhost:3002/host 生成手机扫码二维码
echo.

npm run dev:web
