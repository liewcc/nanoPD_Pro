# nanoPD Pro - Lightweight Portable Electron + Python Dual-Engine Desktop Framework

> **A simplified, fully-automated installation and execution guide for beginners** 🛠️

`nanoPD Pro` is a portable desktop application framework powered by an **Electron** frontend and a **FastAPI (Python)** backend. It features a lightweight, self-contained dependency management system. Even if Python, Node.js, or package managers are not pre-installed on your system, you can configure and run the application with a single click using our automation scripts.

This guide walks you through the automatic setup and execution process step-by-step.

---

## ⚙️ Step 1: Download and Extract the Project

Before setting up the environment, you need to download the repository files to your local machine:

1. **Go to the GitHub Repository**:
   - Open this repository's main page in your browser.
2. **Download the ZIP**:
   - Click the green **Code** button located in the top-right section of the page.
   - Click **Download ZIP** from the dropdown menu to save the project folder onto your computer.
3. **Extract the ZIP**:
   - Locate the downloaded `.zip` file on your computer.
   - Right-click the file and select **Extract All...** to extract it into a local directory of your choice.

---

## ⚙️ Step 2: Automatic Project Setup

Once the project files are extracted, follow these steps to configure the environment:

1. **Open the project folder**:
   - Double-click and enter the extracted `nanoPD_Pro` folder (the directory containing `setup.bat`).

2. **Run the setup script**:
   - Double-click the **`setup.bat`** file.
   - A black command prompt window will open, showing the installation progress of the `nanoPD Pro Setup Engine`.

3. **What the script does automatically**:
   - **Install Astral uv**: Checks for the ultra-fast Python package installer (`uv`). If not found, it automatically downloads and configures it.
   - **Configure Python environment**: Automatically creates a `.venv` virtual environment in the project directory and installs all Python backend dependencies listed in `requirements.txt` (FastAPI, Uvicorn, pyserial, paho-mqtt, etc.).
   - **Configure Node.js environment**:
     - If you already have Node.js installed globally, it will use your system's Node.js.
     - If you don't have Node.js installed, **no worries!** The script automatically downloads a portable, green Node.js version from the official website and saves it in the `.node_portable` directory.
   - **Install frontend dependencies**: Automatically installs Electron and the required runtime libraries.
   - **Create a Desktop Shortcut**: Generates a shortcut named **"Nano PD PRO"** with a custom icon on your Windows desktop.

4. **Complete Setup**:
   - When the window displays `[SUCCESS] nanoPD Pro is ready to be launched!`, press any key to close the setup window.

---

## 🚀 Step 3: Run the Application

Once the automatic setup is complete, you can launch the app using either of the following simple methods:

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

1. **Does this project pollute registry or global environment settings?**
   - **Absolutely not!** This project follows a **Green/Portable** design philosophy.
   - All dependencies (including Node.js and the Python virtual environment) are installed inside `.node_portable` and `.venv` within the project root. Deleting the project folder will completely uninstall everything without leaving any residue.

2. **Why does the application crash immediately after launch?**
   - Check the automatically generated `backend.log` file in the root directory to see if there are port conflicts or serial port access issues.
   - If you encounter issues, try running `setup.bat` again to repair the dependency environment.

---

Enjoy using nanoPD Pro! If you have any questions, feel free to contact the developers. ✨
