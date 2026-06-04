const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow = null;
let pythonProcess = null;
let backendPort = 9000; // Default fallback
let tray = null;
let isQuitting = false;

// Helper to check if a port is free
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

// Find a free port starting from a given port
async function getFreePort(startPort = 9000) {
  let port = startPort;
  while (!(await checkPort(port))) {
    port++;
  }
  return port;
}

// Spawn the Python Backend
function startPythonBackend(port) {
  const isWin = process.platform === 'win32';
  const pythonExe = path.join(__dirname, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  const backendScript = path.join(__dirname, 'backend', 'main.py');

  console.log(`[Main] Launching Python backend: ${pythonExe} ${backendScript} --port ${port}`);

  pythonProcess = spawn(pythonExe, [backendScript, '--port', port.toString()]);

  const fs = require('fs');
  const logFile = path.join(__dirname, 'backend.log');
  // Clear log at startup
  try { fs.writeFileSync(logFile, ''); } catch (e) {}

  // Helper to check if a log line is noisy WebSocket connection/disconnection info
  function isNoisyWebSocketLog(line) {
    const lower = line.toLowerCase();
    // Do not suppress actual tracebacks or exception dumps
    if (lower.includes('traceback') || lower.includes('exception:')) {
      return false;
    }
    return lower.includes('websocket') || 
           lower.includes('/ws') || 
           lower.includes('connection rejected') || 
           lower.includes('connection closed') ||
           lower.includes('websocket disconnect');
  }

  pythonProcess.stdout.on('data', (data) => {
    const text = data.toString();
    const lines = text.split(/\r?\n/);
    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isNoisyWebSocketLog(trimmed)) continue;
      
      console.log(`[Python] ${trimmed}`);
      try { fs.appendFileSync(logFile, `[Python] ${trimmed}\n`); } catch (e) {}
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const text = data.toString();
    const lines = text.split(/\r?\n/);
    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isNoisyWebSocketLog(trimmed)) continue;
      
      console.error(`[Python Error] ${trimmed}`);
      try { fs.appendFileSync(logFile, `[Python Error] ${trimmed}\n`); } catch (e) {}
    }
  });

  pythonProcess.on('close', (code) => {
    console.log(`[Main] Python process exited with code ${code}`);
    try { fs.appendFileSync(logFile, `[Main] Python process exited with code ${code}\n`); } catch (e) {}
  });
}

// Create System Tray
function createTray(iconPath) {
  if (tray) return;

  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Launcher',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('nanoPD Pro');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

async function createWindow() {
  backendPort = await getFreePort(9000);
  startPythonBackend(backendPort);

  const iconPath = path.join(__dirname, process.platform === 'win32' ? 'frontend/assets/logo.ico' : 'frontend/assets/logo.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "nanoPD Pro Launcher",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Hide native menu bar by default unless show_menu_bar.flag exists
  const fs = require('fs');
  const showMenuFlagPath = path.join(__dirname, 'show_menu_bar.flag');
  if (!fs.existsSync(showMenuFlagPath)) {
    mainWindow.removeMenu();
  }

  // Create System Tray
  createTray(iconPath);

  // Load the index.html and pass the assigned backend port as a query parameter
  mainWindow.loadFile(path.join(__dirname, 'frontend/index.html'), {
    query: { port: backendPort.toString() }
  });

  // Open DevTools in development if requested
  // mainWindow.webContents.openDevTools();

  // Intercept close event (hide to tray if close_to_tray flag exists, otherwise quit)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      const fs = require('fs');
      const flagPath = path.join(__dirname, 'close_to_tray.flag');
      if (fs.existsSync(flagPath)) {
        event.preventDefault();
        mainWindow.hide();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('get-port', () => {
  return backendPort;
});

ipcMain.handle('set-show-menu-bar', (event, show) => {
  const fs = require('fs');
  const flagPath = path.join(__dirname, 'show_menu_bar.flag');
  if (show) {
    fs.writeFileSync(flagPath, 'true');
  } else {
    try {
      if (fs.existsSync(flagPath)) {
        fs.unlinkSync(flagPath);
      }
    } catch (e) {
      console.error(e);
    }
  }
  return true;
});

ipcMain.handle('get-show-menu-bar', () => {
  const fs = require('fs');
  const flagPath = path.join(__dirname, 'show_menu_bar.flag');
  return fs.existsSync(flagPath);
});

ipcMain.handle('set-hide-cli', (event, hide) => {
  const fs = require('fs');
  const flagPath = path.join(__dirname, 'hide_cli.flag');
  if (hide) {
    fs.writeFileSync(flagPath, 'true');
  } else {
    try {
      if (fs.existsSync(flagPath)) {
        fs.unlinkSync(flagPath);
      }
    } catch (e) {
      console.error(e);
    }
  }
  return true;
});

ipcMain.handle('get-hide-cli', () => {
  const fs = require('fs');
  const flagPath = path.join(__dirname, 'hide_cli.flag');
  return fs.existsSync(flagPath);
});

ipcMain.handle('set-close-to-tray', (event, enable) => {
  const fs = require('fs');
  const flagPath = path.join(__dirname, 'close_to_tray.flag');
  if (enable) {
    fs.writeFileSync(flagPath, 'true');
  } else {
    try {
      if (fs.existsSync(flagPath)) {
        fs.unlinkSync(flagPath);
      }
    } catch (e) {
      console.error(e);
    }
  }
  return true;
});

ipcMain.handle('get-close-to-tray', () => {
  const fs = require('fs');
  const flagPath = path.join(__dirname, 'close_to_tray.flag');
  return fs.existsSync(flagPath);
});

ipcMain.handle('write-mqtt-log', (event, content) => {
  const fs = require('fs');
  const dataDir = path.join(__dirname, 'data');
  const logPath = path.join(dataDir, 'mqtt.log');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(logPath, content, 'utf8');
    return { ok: true, path: logPath };
  } catch (e) {
    console.error('[Main] Failed to write mqtt.log:', e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('save-system-config', (event, configData) => {
  const fs = require('fs');
  const dataDir = path.join(__dirname, 'data');
  const configPath = path.join(dataDir, 'system_config.json');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
    return { ok: true, path: configPath };
  } catch (e) {
    console.error('[Main] Failed to write system_config.json:', e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('load-system-config', (event) => {
  const fs = require('fs');
  const configPath = path.join(__dirname, 'data', 'system_config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      return { ok: true, data: JSON.parse(raw) };
    }
    return { ok: false, error: 'File does not exist' };
  } catch (e) {
    console.error('[Main] Failed to read system_config.json:', e);
    return { ok: false, error: e.message };
  }
});

ipcMain.on('log-error', (event, errorText) => {
  const fs = require('fs');
  const logFile = path.join(__dirname, 'backend.log');
  try { fs.appendFileSync(logFile, `[Renderer Error] ${errorText}\n`); } catch (e) {}
});

function killPythonProcess() {
  if (pythonProcess) {
    console.log('[Main] Terminating Python backend...');
    try {
      if (process.platform === 'win32') {
        // Use taskkill to kill the Python process and all child processes it spawned
        spawn('taskkill', ['/pid', pythonProcess.pid, '/f', '/t']);
      } else {
        pythonProcess.kill();
      }
    } catch (err) {
      console.error('[Main] Failed to kill Python backend process:', err);
    }
    pythonProcess = null;
  }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Focus the existing window if user tries to open a second instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('before-quit', () => {
    isQuitting = true;
    killPythonProcess();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Graceful cleanup on app exit
  app.on('will-quit', () => {
    killPythonProcess();
  });

  // Additional process exit handlers
  process.on('exit', () => {
    killPythonProcess();
  });

  process.on('SIGINT', () => {
    killPythonProcess();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    killPythonProcess();
    process.exit(0);
  });
}

