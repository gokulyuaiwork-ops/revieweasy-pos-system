@echo off
title ReviewEasy POS Automation Agent
color 0A
cd /d "%~dp0"

echo ========================================================
echo   REVIEWEASY POS PRINT ^& WHATSAPP AUTOMATION AGENT
echo   Connected to: https://pos.revieweasy.in
echo ========================================================
echo.

:: Check if port 3000 is already active
netstat -ano | findstr :3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] ReviewEasy POS Agent is already running!
    echo Opening dashboard in browser...
    start http://localhost:3000
    exit /b 0
)

echo [1/2] Starting ReviewEasy Background Engine...
if exist "dist\ReviewEasy-POS-Agent.exe" (
    start "" "dist\ReviewEasy-POS-Agent.exe"
) else (
    start "ReviewEasy POS Engine" /min "C:\Program Files\nodejs\node.exe" src\server.js
)

echo [2/2] Waiting for server initialization...
timeout /t 3 /nobreak >nul

echo [3/3] Opening Dashboard in browser...
start http://localhost:3000

echo.
echo ========================================================
echo   ReviewEasy Agent is running independently!
echo   Raw TCP Interceptor: 0.0.0.0:9100
echo   Web Telemetry Feed : http://localhost:3000
echo ========================================================
timeout /t 2 /nobreak >nul
