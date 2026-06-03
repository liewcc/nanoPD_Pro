@echo off
setlocal enabledelayedexpansion

title nanoPD Pro - Setup Deck
cd /d "%~dp0"

echo ==================================================
echo             nanoPD Pro Setup Engine              
echo ==================================================
echo.

:: 1. Verify uv is present
echo [1/5] Checking for Astral uv engine...
where uv >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Astral uv was not found. Installing it automatically...
    powershell -Command "irm https://astral.sh/uv/install.ps1 | iex"
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

:: Re-verify uv is present after potential installation
where uv >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] 'uv' could not be found or installed automatically.
    echo Please run the following command manually in PowerShell to install:
    echo powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
    pause
    exit /b
)
echo [OK] uv is ready.

:: 2. Initialize Python virtual environment via uv
echo.
echo [2/5] Initializing Python 3.12 virtual environment in .venv...
if not exist .venv (
    uv venv --python 3.12
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to initialize Python virtual environment.
        pause
        exit /b
    )
) else (
    echo [INFO] Python virtual environment .venv already exists.
)

echo [INFO] Installing Python backend dependencies...
uv pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies.
    pause
    exit /b
)
echo [OK] Python dependencies installed.

:: 3. Setup Portable green Node.js if system node is missing
echo.
echo [3/5] Checking for Node.js engine...
where node >nul 2>nul
if %errorlevel%==0 (
    echo [OK] Global Node.js detected. System Node will be utilized.
    set USE_PORTABLE=0
) else (
    echo [INFO] Global Node.js not found. Setting up portable Node.js environment...
    if not exist .node_portable (
        echo [INFO] Downloading portable Node.js ZIP v20.12.2 x64...
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-win-x64.zip' -OutFile 'node_portable.zip'"
        if !errorlevel! neq 0 (
            echo [ERROR] Download failed. Check your internet connection.
            pause
            exit /b
        )
        echo [INFO] Extracting Node.js binary files...
        powershell -Command "Expand-Archive -Path 'node_portable.zip' -DestinationPath '.'"
        powershell -Command "Rename-Item -Path 'node-v20.12.2-win-x64' -NewName '.node_portable' -Force"
        del node_portable.zip
        echo [OK] Portable Node.js successfully set up in .node_portable.
    ) else (
        echo [INFO] Portable Node.js already present in .node_portable.
    )
    set USE_PORTABLE=1
)

:: 4. Install Node package dependencies (Electron)
echo.
echo [4/5] Installing Electron dependencies...
if "%USE_PORTABLE%"=="1" (
    :: Add local portable node folder to temporary path variables
    set "PATH=%cd%\.node_portable;%PATH%"
    call .node_portable\npm.cmd install
) else (
    call npm install
)

if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Node.js dependencies.
    pause
    exit /b
)

:: 5. Create Desktop Shortcut
echo.
echo [5/5] Creating Desktop Shortcut...
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\Desktop\Nano PD PRO.lnk'); $Shortcut.TargetPath = '%~dp0run.vbs'; $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.IconLocation = '%~dp0img\logo.ico'; $Shortcut.Save()"
if %errorlevel% equ 0 (
    echo [OK] Desktop shortcut created successfully with logo.ico.
) else (
    echo [WARNING] Failed to create desktop shortcut.
)

echo.
echo ==================================================
echo               SETUP COMPLETE!                      
echo ==================================================
echo [SUCCESS] nanoPD Pro is ready to be launched!
echo Run 'run.bat' to start the application.
echo ==================================================
echo.
pause
