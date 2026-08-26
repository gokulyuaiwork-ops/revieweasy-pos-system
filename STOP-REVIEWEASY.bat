@echo off
title Stop ReviewEasy Agent
color 0C

echo ========================================================
echo   STOPPING REVIEWEASY BACKGROUND SERVICE
echo ========================================================
echo.

echo Terminating ReviewEasy background tasks...
taskkill /F /IM ReviewEasy-POS-Agent.exe >nul 2>&1
taskkill /F /IM node.exe /FI "WINDOWTITLE eq ReviewEasy*" >nul 2>&1

echo.
echo [DONE] ReviewEasy Agent has been stopped.
echo.
pause
