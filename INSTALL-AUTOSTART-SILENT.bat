@echo off
title Install ReviewEasy Silent Autostart
color 0A

echo ========================================================
echo   INSTALLING REVIEWEASY SILENT BACKGROUND SERVICE
echo ========================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "VBS_PATH=%SCRIPT_DIR%ReviewEasy-Silent-Launcher.vbs"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\ReviewEasy-Agent.lnk"

echo [1/2] Creating Windows Startup Shortcut...

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%VBS_PATH%'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo [2/2] Launching ReviewEasy silently in background right now...
    wscript.exe "%VBS_PATH%"
    echo.
    echo ========================================================
    echo   SUCCESS! REVIEWEASY IS NOW CONFIGURED!
    echo.
    echo   1. The agent is running right now silently.
    echo   2. It will automatically start every time Windows boots.
    echo   3. ZERO terminal window will ever be shown to cashier!
    echo ========================================================
) else (
    echo [ERROR] Could not create startup shortcut.
)

echo.
pause
