# nanoPD Pro - Lightweight Portable Electron + Python Dual-Engine Desktop Framework

> **A simplified installation and execution guide for beginners/non-technical users** 🛠️

`nanoPD Pro` is a portable desktop application framework powered by an **Electron** frontend and a **FastAPI (Python)** backend. It features a lightweight, self-contained dependency management system. Even if Python or Node.js is not pre-installed on your system, you can configure and run the application with a single click using our automation scripts.

This guide is designed for beginners to walk you through the setup and execution process step-by-step.

---

## 📋 Prerequisites

Before starting, you need to install **Astral uv** (an extremely fast Python package installer and resolver) on your Windows machine (**this is the only manual installation required**).

### Step 1: Install Astral uv
1. **Open PowerShell**:
   - Press the `Win + R` keys on your keyboard, type `powershell` in the pop-up "Run" dialog, and press Enter (or click OK).
2. **Copy and Paste the command below** (select and copy, then right-click in the PowerShell window to paste it), and press Enter:
   ```powershell
   irm https://astral.sh/uv/install.ps1 | iex
   ```
3. **Verify the installation**:
   - Once completed, type the following command and press Enter:
     ```powershell
     uv --version
     ```
   - If you see a version number output like `uv 0.x.x`, your system is ready!

---

## ⚙️ Step 2: Project Setup

If you have downloaded and extracted this project to a local folder, follow these steps to configure the environment:

1. **Open the project root directory**:
   - Double-click and enter the `nanoPD_Pro` folder (the directory containing `setup.bat`).

2. **Run the setup script**:
   - Double-click the **`setup.bat`** file.
   - A black command prompt window will open, showing the installation progress of the `nanoPD Pro Setup Engine`.

3. **What the script does automatically**:
   - **Check for `uv` environment**: Verifies that the `uv` tool is installed.
   - **Configure Python environment**: Automatically creates a `.venv` virtual environment in the project directory and installs all Python backend dependencies listed in `requirements.txt` (including FastAPI, Uvicorn, pyserial, paho-mqtt, etc.).
   - **Configure Node.js environment**:
     - If you already have Node.js installed globally, it will use your system's Node.js.
     - If you don't have Node.js installed, **no worries!** The script will automatically download a portable, green Node.js version from the official website and save it in the `.node_portable` directory.
   - **Install frontend dependencies**: Automatically installs Electron and the required runtime libraries.
   - **Create a Desktop Shortcut**: Generates a shortcut named **"Nano PD PRO"** with a custom icon on your Windows desktop.

4. **Complete Setup**:
   - When the window displays `[SUCCESS] nanoPD Pro is ready to be launched!`, press any key to close the setup window.

---

## 🚀 Step 3: Run the Application

Once the environment setup is complete, you no longer need to use command lines to launch the app! We provide two simple startup methods:

### Method 1: Desktop Shortcut (Highly Recommended ⭐️)
- Go to your Windows desktop, locate and double-click the **`Nano PD PRO`** shortcut icon to run the app.

### Method 2: Launch Script in the Project Directory
- Open the project root directory and double-click the **`run.bat`** file.

---

## 📂 Project Structure Overview

After setup, you will find the following key files and folders in the project directory:

- 📂 **`backend/`**: Python backend source code built on FastAPI, handling serial communication (`Serial`), `MQTT` transmission, system diagnostics (`psutil`), and other business logic.
- 📂 **`frontend/`**: Frontend web assets, including `index.html`, `style.css`, and `renderer.js`. It features a premium, deep dark aesthetic.
- 📂 **`img/`**: Project icons and image resources (such as `logo.ico`).
- 📄 **`main.js`**: Electron main process entry, responsible for launching the window, dynamically scanning backend ports, and lifecycle management (automatically cleaning up Python processes on exit).
- 📄 **`requirements.txt`**: Python dependencies list.
- 📄 **`package.json`**: Node.js package metadata declaring Electron dependencies.
- 📄 **`rule.md`**: Guidelines and design standards for development.
- 🛡️ **`hide_cli.flag`**: *(Control Flag)* If this file exists, launching the application via the shortcut or `run.vbs` will start the backend silently in the background, suppressing the command prompt window.

---

## ⚠️ Troubleshooting & FAQ

1. **Why does running `setup.bat` complain that 'uv' is not found?**
   - Make sure you successfully installed `uv` as detailed in the [Prerequisites](#-prerequisites) section.
   - If it is installed but still unrecognized, try opening a new File Explorer / PowerShell window, or run PowerShell as Administrator to re-run the `uv` installation command.

2. **Does this project pollute registry or global environment settings?**
   - **Absolutely not!** This project follows a **Green/Portable** design philosophy.
   - All dependencies (including Node.js and the Python virtual environment) are installed inside `.node_portable` and `.venv` within the project root. Deleting the project folder will completely uninstall everything without leaving any residue.

3. **Why does the application crash immediately after launch?**
   - Check the automatically generated `backend.log` file in the root directory to see if there are port conflicts or serial port access issues.
   - If you encounter issues, try running `setup.bat` again to repair the dependency environment.

---

Enjoy using nanoPD Pro! If you have any questions, feel free to contact the developers. ✨
