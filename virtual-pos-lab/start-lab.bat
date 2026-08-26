@echo off
title ReviewEasy & Virtual POS Lab Launcher
color 0A

echo ========================================================
echo  REVIEWEASY & VIRTUAL POS HARDWARE TESTING LAB
echo ========================================================
echo.
echo Starting ReviewEasy Production Server (:3000)...
start "ReviewEasy Core Engine" cmd /k "npm start"

timeout /t 2 /nobreak >nul

echo Starting Virtual POS Lab (:3001)...
start "Virtual POS Lab" cmd /k "node virtual-pos-lab/server.js"

timeout /t 2 /nobreak >nul

echo Opening Virtual POS & Dashboard in Browser...
start http://localhost:3001
start http://localhost:3000

echo.
echo [SUCCESS] Both servers active!
echo - ReviewEasy Dashboard: http://localhost:3000
echo - Virtual POS Simulator: http://localhost:3001
echo.
pause
