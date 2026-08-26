@echo off
title ReviewEasy POS & WhatsApp Automation Agent
color 0A
echo ========================================================
echo   REVIEWEASY POS PRINT & WHATSAPP AUTOMATION AGENT
echo   Connected to: https://pos.revieweasy.in
echo ========================================================
echo.

if exist "dist\ReviewEasy-POS-Agent.exe" (
    echo [1/2] Starting ReviewEasy Standalone Agent...
    start "" "dist\ReviewEasy-POS-Agent.exe"
) else (
    echo [1/2] Starting via Node Runtime...
    start "" node src/server.js
)

timeout /t 3 /nobreak >nul
echo [2/2] Opening Dashboard in browser...
start http://localhost:3000

echo.
echo ========================================================
echo   ReviewEasy Agent is running in the background!
echo   Raw TCP Interceptor active on port 9100.
echo   Web Telemetry on: http://localhost:3000
echo ========================================================
pause
