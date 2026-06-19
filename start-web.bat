@echo off
REM CodeRelay Web startup script (Windows)

echo Starting CodeRelay Web...
echo.
echo Web UI will be available at: http://localhost:3000
echo Host API: http://localhost:3002
echo Auth Token: test-token-123456
echo P2P: 登录后点击侧栏 "添加设备" 生成手机扫码二维码
echo.

npm run dev:web
