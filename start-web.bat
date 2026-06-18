@echo off
REM CodeRelay Web startup script (Windows)

echo Starting CodeRelay Web...
echo.
echo Web UI will be available at: http://localhost:3000
echo Host API: http://localhost:3002
echo Auth Token: test-token-123456
echo.

npm run dev:web
