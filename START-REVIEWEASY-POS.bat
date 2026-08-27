@echo off
title ReviewEasy POS Automation Agent
color 0A
cd /d "%~dp0"

echo ========================================================
echo   REVIEWEASY POS PRINT ^& WHATSAPP AUTOMATION AGENT
echo   Connected to: https://pos.revieweasy.in
echo ========================================================
echo.

echo [1/2] Starting ReviewEasy POS Engine on port 3000...
start "ReviewEasy POS Server" node src/server.js

echo [2/2] Waiting for server initialization...
timeout /t 3 /nobreak >nul

echo [3/3] Opening Dashboard in browser...
start http://localhost:3000

echo.
echo ========================================================
echo   ReviewEasy Agent is now active!
echo   Raw TCP Interceptor: 0.0.0.0:9100
echo   Local Dashboard    : http://localhost:3000
echo ========================================================
echo.
echo You can keep this window open or minimize it.
pause
