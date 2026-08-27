@echo off
title ReviewEasy POS - 1-Click Master Installer
color 0A

echo ======================================================================
echo          REVIEWEASY POS & WHATSAPP AUTOMATION SYSTEM
echo               1-CLICK CLIENT INSTALLER & AUTO-START
echo ======================================================================
echo.

set "INSTALL_DIR=%~dp0"
if "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"
cd /d "%INSTALL_DIR%"

:: Check if Node.js is available
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js (LTS version) from https://nodejs.org
    echo.
    echo After installing, run this 1-CLICK-INSTALLATION.bat again!
    echo.
    pause
    exit /b 1
)

:: Run the robust autostart setup engine
node "%INSTALL_DIR%\Setup-Autostart.js"

echo.
echo Press any key to close this installer window...
pause >nul
