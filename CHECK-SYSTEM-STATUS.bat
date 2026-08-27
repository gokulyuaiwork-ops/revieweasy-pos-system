@echo off
title "ReviewEasy POS - System Health & Autostart Diagnostics"
color 0B

set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"
cd /d "%DIR%"

node "%DIR%\Verify-Status.js"

echo.
pause
