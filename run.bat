@echo off
title nanoPD Pro Launcher
cd /d "%~dp0"

echo ==================================================
echo             nanoPD Pro Startup Deck              
echo ==================================================

:: Detect portable Node.js and append to PATH locally for this terminal session
if exist .node_portable (
    echo [INFO] Injecting portable Node.js into runtime PATH...
    set "PATH=%cd%\.node_portable;%PATH%"
) else (
    echo [INFO] Utilizing system Node.js path...
)

echo [INFO] Starting Electron shell process...
echo.

:: Launch Electron via npm start script defined in package.json
call npm start

if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Electron process exited with code %errorlevel%.
    pause
)
