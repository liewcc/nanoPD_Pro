// Read backend port passed as URL search param
const urlParams = new URLSearchParams(window.location.search);
let backendPort = urlParams.get('port') || '9000';

let BASE_URL = `http://127.0.0.1:${backendPort}`;

// Sidebar Frame DOM Elements
const displayPorts = document.querySelectorAll('.display-port');
const electronStatuses = document.querySelectorAll('.electron-status');
const backendStatuses = document.querySelectorAll('.backend-status');
const mqttStatuses = document.querySelectorAll('.mqtt-status');

// Navigation Tabs
const navDashboard = document.getElementById('nav-dashboard');
const navMqtt = document.getElementById('nav-mqtt');
const navSystemConfig = document.getElementById('nav-system-config');
const navVisitRepo = document.getElementById('nav-visit-repo');

const viewDashboard = document.getElementById('view-dashboard');
const viewMqtt = document.getElementById('view-mqtt');
const viewSystemConfigPane = document.getElementById('view-system-config-pane');

// Initialize Sidebar UI
displayPorts.forEach(el => el.innerText = backendPort);
electronStatuses.forEach(el => el.className = 'job-status-badge conn-badge-connected electron-status'); // Electron is running

// Navigation Handling
function updateSidebarCsqCardVisibility() {
  const card = document.getElementById('cell-auto-csq-card');
  const crcCard = document.getElementById('crc-delay-card');
  const debugCard = document.getElementById('debugging-tool-card');
  const isMqttActive = navMqtt && navMqtt.classList.contains('active');
  const isCellularActive = subTabBtnCellular && subTabBtnCellular.classList.contains('active');
  
  if (card) {
    if (isMqttActive && isCellularActive) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  }
  
  if (crcCard) {
    if (isMqttActive) {
      crcCard.style.display = 'block';
    } else {
      crcCard.style.display = 'none';
    }
  }

  if (debugCard) {
    if (isMqttActive) {
      debugCard.style.display = 'block';
    } else {
      debugCard.style.display = 'none';
    }
  }
}

// Initialize and save CRC Check Delay setting
const crcDelayInput = document.getElementById('crc-check-delay');
if (crcDelayInput) {
  const savedDelay = localStorage.getItem('crc_check_delay');
  if (savedDelay !== null) {
    crcDelayInput.value = savedDelay;
  }
  crcDelayInput.addEventListener('change', () => {
    localStorage.setItem('crc_check_delay', crcDelayInput.value);
  });
}

function switchView(activeTab, targetPane) {
  [navDashboard, navMqtt, navSystemConfig].forEach(tab => tab && tab.classList.remove('active'));
  [viewDashboard, viewMqtt, viewSystemConfigPane].forEach(pane => pane && pane.classList.remove('active'));

  activeTab.classList.add('active');
  targetPane.classList.add('active');
  
  updateSidebarCsqCardVisibility();
}

if (navDashboard) navDashboard.addEventListener('click', () => switchView(navDashboard, viewDashboard));
if (navMqtt) navMqtt.addEventListener('click', () => switchView(navMqtt, viewMqtt));
if (navSystemConfig) navSystemConfig.addEventListener('click', () => switchView(navSystemConfig, viewSystemConfigPane));
if (navVisitRepo) {
  navVisitRepo.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal('https://github.com/liewcc/nanoPD_Pro');
    }
  });
}

// Check backend connectivity regularly
async function checkBackendHealth() {
  try {
    const response = await fetch(`${BASE_URL}/`);
    if (response.ok) {
      backendStatuses.forEach(el => el.className = 'job-status-badge conn-badge-connected backend-status');
    } else {
      backendStatuses.forEach(el => el.className = 'job-status-badge conn-badge-disconnected backend-status');
    }
  } catch (error) {
    backendStatuses.forEach(el => el.className = 'job-status-badge conn-badge-disconnected backend-status');
  }
}

// Update all MQTT pill badges across both status cards
function setMqttBadgeStatus(connected) {
  const cls = connected ? 'conn-badge-connected' : 'conn-badge-disconnected';
  mqttStatuses.forEach(el => {
    el.className = `job-status-badge ${cls} mqtt-status`;
  });
}

// Template API Helper to call your Python FastAPI backend
async function callBackend(endpoint, options = {}) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`API Call to ${endpoint} failed:`, error);
    throw error;
  }
}

let lastPorts = null;
let lastDetails = null;
let serialSocket = null;
let preferredPort = '';

const activeSessions = new Map();
let activeTabUid = null;

function getDeviceUid(info) {
  const vid = info.vid || 'unknown';
  const pid = info.pid || 'unknown';
  const ser = (info.ser && info.ser !== '------') ? info.ser : 'noserial';
  const mfr = info.manufacturer || 'unknown';
  return `dev_${vid}_${pid}_${ser}_${mfr}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

function switchSerialTab(deviceUid) {
  const session = activeSessions.get(deviceUid);
  if (!session) return;
  
  activeTabUid = deviceUid;
  
  document.querySelectorAll('.com-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-uid') === deviceUid) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  document.querySelectorAll('.com-workspace-wrapper').forEach(wrapper => {
    if (wrapper.getAttribute('data-uid') === deviceUid) {
      wrapper.classList.add('active');
    } else {
      wrapper.classList.remove('active');
    }
  });
}

function updateComPortDropdown(ports, details = {}) {
  const tabContainer = document.getElementById('com-tool-tab-bar');
  const placeholder = document.getElementById('com-empty-placeholder');
  if (!tabContainer) return;
  
  // Track which deviceUids are currently plugged in
  const onlineUids = new Set();
  
  ports.forEach(port => {
    const info = details[port];
    if (!info) return;
    const deviceUid = getDeviceUid(info);
    onlineUids.add(deviceUid);
    
    if (!activeSessions.has(deviceUid)) {
      // Create new session
      const session = new SerialPortSession(deviceUid, info);
      activeSessions.set(deviceUid, session);
      
      // Add tab button to DOM
      const tabBtn = document.createElement('button');
      tabBtn.className = 'sub-tab-btn com-tab-btn online';
      tabBtn.setAttribute('data-uid', deviceUid);
      tabBtn.innerHTML = `
        <span class="com-tab-dot"></span>
        <span class="com-tab-name">${port}</span>
        <span class="com-tab-close">×</span>
      `;
      
      // Tab click switches view
      tabBtn.addEventListener('click', (e) => {
        if (e.target.classList.contains('com-tab-close')) {
          return;
        }
        switchSerialTab(deviceUid);
      });
      
      // Close button handler
      tabBtn.querySelector('.com-tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        const sess = activeSessions.get(deviceUid);
        if (sess) {
          const confirmClose = sess.isOnline ? confirm(`Close connection and remove tab for ${port}?`) : true;
          if (confirmClose) {
            sess.destroy();
            activeSessions.delete(deviceUid);
            tabBtn.remove();
            
            if (activeTabUid === deviceUid) {
              const remainingUids = Array.from(activeSessions.keys());
              if (remainingUids.length > 0) {
                switchSerialTab(remainingUids[0]);
              } else {
                activeTabUid = null;
                tabContainer.style.display = 'none';
              }
            }
            
            // Toggle placeholder display
            if (activeSessions.size > 0) {
              if (placeholder) placeholder.style.display = 'none';
            } else {
              if (placeholder) placeholder.style.display = 'flex';
            }
          }
        }
      });
      
      tabContainer.appendChild(tabBtn);
    } else {
      // Session already exists. Check if it was offline, or if COM port number changed
      const session = activeSessions.get(deviceUid);
      if (!session.isOnline) {
        session.setOnline(info);
      } else if (session.portName !== port) {
        session.setOnline(info);
      }
    }
  });
  
  // Mark missing ports as offline
  for (const [deviceUid, session] of activeSessions.entries()) {
    if (!onlineUids.has(deviceUid) && session.isOnline) {
      session.setOffline();
    }
  }

  // Update occupation status for all online sessions
  activeSessions.forEach((session) => {
    if (session.isOnline) {
      const portInfo = details[session.portName] || {};
      session.updateOccupationStatus(portInfo.occupied);
    }
  });
  
  // Show/hide tab bar and toggle placeholder based on whether we have any sessions
  if (activeSessions.size > 0) {
    tabContainer.style.display = 'flex';
    if (placeholder) placeholder.style.display = 'none';
    
    // If no tab is currently selected, select the first online one or first available
    if (!activeTabUid || !activeSessions.has(activeTabUid)) {
      const remainingUids = Array.from(activeSessions.keys());
      const firstOnline = remainingUids.find(uid => activeSessions.get(uid).isOnline);
      switchSerialTab(firstOnline || remainingUids[0]);
    }
  } else {
    tabContainer.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    activeTabUid = null;
  }
}

function rebuildComPortBadges(ports, details) {
  const containers = document.querySelectorAll('.com-port-left');
  const cards = document.querySelectorAll('.com-port-card');
  
  if (!ports || ports.length === 0) {
    cards.forEach(card => card.className = 'com-port-card glass');
    containers.forEach(container => container.innerHTML = '');
    return;
  }
  
  cards.forEach(card => card.className = 'com-port-card glass');
  let html = '';
  ports.forEach((port, idx) => {
    const marginLeft = idx === 0 ? '0' : '8px';
    const info = details[port] || {
      port: port,
      name: `Serial Port (${port})`,
      manufacturer: "------",
      vid: "------",
      pid: "------",
      ser: "------",
      occupied: false
    };
    const badgeClass = info.occupied ? 'conn-badge-occupied' : 'conn-badge-connected';
    const tooltipHeaderStyle = info.occupied ? 'color: var(--danger);' : '';
    const occupiedText = info.occupied ? ' (Occupied)' : '';
    
    html += `
      <span class="job-status-badge ${badgeClass} port-pill" style="margin-left: ${marginLeft};">
        ${port}
        <div class="port-tooltip">
          <div class="tooltip-header" style="${tooltipHeaderStyle}">${info.port} - ${info.name}${occupiedText}</div>
          <div class="tooltip-divider"></div>
          <div class="tooltip-line"><span class="tooltip-lbl">MFR:</span><span class="tooltip-val">${info.manufacturer}</span></div>
          <div class="tooltip-line"><span class="tooltip-lbl">VID:</span><span class="tooltip-val">${info.vid}</span></div>
          <div class="tooltip-line"><span class="tooltip-lbl">PID:</span><span class="tooltip-val">${info.pid}</span></div>
          <div class="tooltip-line"><span class="tooltip-lbl">SER:</span><span class="tooltip-val">${info.ser}</span></div>
        </div>
      </span>
    `;
  });
  containers.forEach(container => container.innerHTML = html);
}

async function updateComPorts() {
  const containers = document.querySelectorAll('.com-port-left');
  const cards = document.querySelectorAll('.com-port-card');

  try {
    const response = await fetch(`${BASE_URL}/api/com_ports`);
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    const data = await response.json();
    if (data.status === 'success' && Array.isArray(data.ports)) {
      const ports = data.ports;
      const details = data.details || {};
      
      // Only update DOM if the ports list or details changed to prevent flickering
      if (JSON.stringify(lastPorts) !== JSON.stringify(ports) || JSON.stringify(lastDetails) !== JSON.stringify(details)) {
        lastPorts = ports;
        lastDetails = details;
        updateComPortDropdown(ports, details);
        rebuildComPortBadges(ports, details);
      }
    } else {
      if (JSON.stringify(lastPorts) !== JSON.stringify([])) {
        lastPorts = [];
        lastDetails = null;
        cards.forEach(card => card.className = 'com-port-card glass');
        containers.forEach(container => {
          container.innerHTML = `
            <span class="job-status-badge conn-badge-disconnected">OFFLINE</span>
            <span style="color: var(--danger); font-size: 13px; font-weight: 500; margin-left: 4px;">API Error (${data.message || 'Unknown'})</span>
          `;
        });
      }
    }
  } catch (error) {
    console.error('Failed to fetch COM ports:', error);
    if (JSON.stringify(lastPorts) !== JSON.stringify([])) {
      lastPorts = [];
      lastDetails = null;
      cards.forEach(card => card.className = 'com-port-card glass');
      containers.forEach(container => {
        container.innerHTML = `
          <span class="job-status-badge conn-badge-disconnected">OFFLINE</span>
          <span style="color: var(--danger); font-size: 13px; font-weight: 500; margin-left: 4px;">Connection Error</span>
        `;
      });
    }
  }
}

// Retrieve port dynamically via IPC to bypass URL query parsing issues on file:// protocol
if (window.electronAPI && window.electronAPI.getBackendPort) {
  window.electronAPI.getBackendPort().then(port => {
    if (port) {
      backendPort = port.toString();
      BASE_URL = `http://127.0.0.1:${backendPort}`;
      displayPorts.forEach(el => el.innerText = backendPort);
      // Re-trigger checks immediately with the correct port
      checkBackendHealth();
      updateComPorts();
    }
  });
}

// Start polling backend connectivity status and COM ports every 3 seconds
checkBackendHealth();
updateComPorts();

setInterval(checkBackendHealth, 3000);
setInterval(updateComPorts, 3000);

// Toggle hide CLI switch logic
const toggleHideCli = document.getElementById('toggle-hide-cli');
if (toggleHideCli && window.electronAPI && window.electronAPI.getHideCliFlag) {
  // Load initial flag state
  window.electronAPI.getHideCliFlag().then(hide => {
    toggleHideCli.checked = hide;
  });

  // Handle changes
  toggleHideCli.addEventListener('change', (e) => {
    if (window.electronAPI.setHideCliFlag) {
      window.electronAPI.setHideCliFlag(e.target.checked);
    }
  });
}

// Toggle close to system tray logic
const toggleCloseToTray = document.getElementById('toggle-close-to-tray');
if (toggleCloseToTray && window.electronAPI && window.electronAPI.getCloseToTrayFlag) {
  // Load initial flag state
  window.electronAPI.getCloseToTrayFlag().then(enable => {
    toggleCloseToTray.checked = enable;
  });

  // Handle changes
  toggleCloseToTray.addEventListener('change', (e) => {
    if (window.electronAPI.setCloseToTrayFlag) {
      window.electronAPI.setCloseToTrayFlag(e.target.checked);
    }
  });
}

// Toggle native menu bar logic
const toggleMenuBar = document.getElementById('toggle-menu-bar');
if (toggleMenuBar && window.electronAPI && window.electronAPI.getShowMenuBarFlag) {
  // Load initial state (checked if flag exists, meaning show native menu bar)
  window.electronAPI.getShowMenuBarFlag().then(show => {
    toggleMenuBar.checked = show;
  });

  // Handle changes
  toggleMenuBar.addEventListener('change', (e) => {
    if (window.electronAPI.setShowMenuBarFlag) {
      window.electronAPI.setShowMenuBarFlag(e.target.checked);
    }
  });
}

// ASCII force printing rules logic
let asciiMatchRules = [];
const asciiRulesBody = document.getElementById('ascii-rules-body');
const inputAsciiRule = document.getElementById('input-ascii-rule');
const btnAddAsciiRule = document.getElementById('btn-add-ascii-rule');

function saveAsciiMatchRules() {
  localStorage.setItem('ascii_match_rules', JSON.stringify(asciiMatchRules));
  saveSystemConfigToFile();
}

function rebuildAsciiMatchRulesUI() {
  if (!asciiRulesBody) return;
  asciiRulesBody.innerHTML = '';
  if (asciiMatchRules.length === 0) {
    asciiRulesBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); font-style: italic;">No rules defined</td></tr>';
    return;
  }
  asciiMatchRules.forEach((rule, idx) => {
    const tr = document.createElement('tr');
    const asciiPreview = hexToString(rule);
    tr.innerHTML = `
      <td style="color: var(--text-main); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px;">${rule}</td>
      <td style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px;">${asciiPreview}</td>
      <td style="text-align: center; vertical-align: middle;">
        <button class="btn-remove-row btn-remove-ascii" data-index="${idx}" style="cursor: pointer; background: transparent; border: none; color: var(--danger);">✖</button>
      </td>
    `;
    asciiRulesBody.appendChild(tr);
  });
  
  // Attach remove handlers
  asciiRulesBody.querySelectorAll('.btn-remove-ascii').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      asciiMatchRules.splice(idx, 1);
      saveAsciiMatchRules();
      rebuildAsciiMatchRulesUI();
      // Rebuild consoles if open
      if (typeof rebuildCellConsole === 'function') rebuildCellConsole();
      if (typeof rebuildInetConsole === 'function') rebuildInetConsole();
    });
  });
}

if (btnAddAsciiRule && inputAsciiRule) {
  btnAddAsciiRule.addEventListener('click', () => {
    const ruleVal = inputAsciiRule.value.trim();
    if (!ruleVal) return;
    
    // Clean and validate hex string (only hex characters and spaces allowed)
    const cleanRule = ruleVal.replace(/\s+/g, '');
    if (!/^[0-9A-Fa-f]+$/.test(cleanRule)) {
      alert('Invalid HEX string! Please enter only hexadecimal characters (0-9, A-F, a-f) and spaces.');
      return;
    }
    
    asciiMatchRules.push(ruleVal);
    saveAsciiMatchRules();
    inputAsciiRule.value = '';
    rebuildAsciiMatchRulesUI();
    
    // Rebuild consoles if open
    if (typeof rebuildCellConsole === 'function') rebuildCellConsole();
    if (typeof rebuildInetConsole === 'function') rebuildInetConsole();
  });
  
  inputAsciiRule.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnAddAsciiRule.click();
    }
  });
}

// Backup Polling List State & UI elements
let backupPollingList = [];
const backupPollCommandsBody = document.getElementById('backup-poll-commands-body');
const inputBackupPollCmd = document.getElementById('input-backup-poll-cmd');
const btnAddBackupPollCmd = document.getElementById('btn-add-backup-poll-cmd');

function saveBackupPollingList() {
  localStorage.setItem('backup_polling_list', JSON.stringify(backupPollingList));
  saveSystemConfigToFile();
}

function rebuildBackupPollingUI() {
  if (!backupPollCommandsBody) return;
  backupPollCommandsBody.innerHTML = '';
  if (backupPollingList.length === 0) {
    backupPollCommandsBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 12px 8px;">No backup commands configured</td></tr>';
    return;
  }
  
  // Sort by index ascending
  backupPollingList.sort((a, b) => a.Index - b.Index);
  
  backupPollingList.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-main); font-size: 11px; padding: 6px 8px;">${item.Index}</td>
      <td style="color: var(--text-main); font-family: var(--font-mono); font-size: 11px; padding: 6px 8px;">${formatHexWithSpaces(item.Command)}</td>
      <td style="text-align: center; vertical-align: middle;">
        <button class="btn-remove-row btn-remove-backup-poll" data-index="${idx}" style="cursor: pointer; background: transparent; border: none; color: var(--danger);">✖</button>
      </td>
    `;
    backupPollCommandsBody.appendChild(tr);
  });

  // Attach remove handlers
  backupPollCommandsBody.querySelectorAll('.btn-remove-backup-poll').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      backupPollingList.splice(idx, 1);
      
      // Re-index remaining commands sequentially
      backupPollingList.forEach((item, i) => {
        item.Index = i + 1;
      });
      
      saveBackupPollingList();
      rebuildBackupPollingUI();
    });
  });
}

if (btnAddBackupPollCmd && inputBackupPollCmd) {
  btnAddBackupPollCmd.addEventListener('click', () => {
    const cmdVal = inputBackupPollCmd.value.trim();
    if (!cmdVal) return;
    
    // Clean and validate hex string (only hex characters and spaces allowed)
    const cleanCmd = cmdVal.replace(/\s+/g, '');
    if (!/^[0-9A-Fa-f]{6,}$/.test(cleanCmd) || cleanCmd.length % 2 !== 0) {
      alert('Invalid Modbus HEX command! Please enter a valid hex string of even length.');
      return;
    }
    
    const nextIdx = backupPollingList.length + 1;
    backupPollingList.push({
      Index: nextIdx,
      Command: cleanCmd.toUpperCase()
    });
    
    saveBackupPollingList();
    inputBackupPollCmd.value = '';
    rebuildBackupPollingUI();
  });
  
  inputBackupPollCmd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnAddBackupPollCmd.click();
    }
  });
}

function saveSystemConfigToFile() {
  const configData = {
    backup_polling_list: backupPollingList,
    ascii_match_rules: asciiMatchRules
  };
  if (window.electronAPI && window.electronAPI.saveSystemConfig) {
    window.electronAPI.saveSystemConfig(configData).then(res => {
      if (res && res.ok) {
        console.log('[System Config] Saved to file successfully:', res.path);
      } else {
        console.error('[System Config] Failed to save to file:', res ? res.error : 'Unknown error');
      }
    });
  }
}

function initializeSystemConfig() {
  if (window.electronAPI && window.electronAPI.loadSystemConfig) {
    window.electronAPI.loadSystemConfig().then(res => {
      if (res && res.ok && res.data) {
        console.log('[System Config] Loaded successfully from file.');
        const data = res.data;
        
        // 1. Load ASCII match rules
        if (Array.isArray(data.ascii_match_rules)) {
          asciiMatchRules = data.ascii_match_rules;
          localStorage.setItem('ascii_match_rules', JSON.stringify(asciiMatchRules));
        } else {
          loadAsciiMatchRulesFromLocalStorage();
        }
        
        // 2. Load backup polling list
        if (Array.isArray(data.backup_polling_list)) {
          backupPollingList = data.backup_polling_list;
          localStorage.setItem('backup_polling_list', JSON.stringify(backupPollingList));
        } else {
          loadBackupPollingListFromLocalStorage();
        }
      } else {
        console.log('[System Config] No JSON config file found or load failed, falling back to LocalStorage.');
        loadAsciiMatchRulesFromLocalStorage();
        loadBackupPollingListFromLocalStorage();
      }
      
      // Rebuild UIs
      rebuildAsciiMatchRulesUI();
      rebuildBackupPollingUI();
    });
  } else {
    loadAsciiMatchRulesFromLocalStorage();
    loadBackupPollingListFromLocalStorage();
    rebuildAsciiMatchRulesUI();
    rebuildBackupPollingUI();
  }
}

function loadAsciiMatchRulesFromLocalStorage() {
  const raw = localStorage.getItem('ascii_match_rules');
  if (raw) {
    try {
      asciiMatchRules = JSON.parse(raw) || [];
    } catch(e) {
      asciiMatchRules = [];
    }
  } else {
    // Default values: the hex notifications DTU sends
    asciiMatchRules = [
      "0D 0A 50 6C 65 61 73 65 20 63 68 65 63 6B 20 47 50 52 53 20 21 21 21 0D 0A",
      "0D 0A 2B 41 54 4B 20 4D 6F 64 75 6C 65 20 57 69 6C 6C 20 52 65 73 74 61 72 74",
      "41 54 4B 2D 4C 54 45 2D 44 54 55"
    ];
    localStorage.setItem('ascii_match_rules', JSON.stringify(asciiMatchRules));
  }
}

function loadBackupPollingListFromLocalStorage() {
  const raw = localStorage.getItem('backup_polling_list');
  if (raw) {
    try {
      backupPollingList = JSON.parse(raw) || [];
    } catch(e) {
      backupPollingList = [];
    }
  } else {
    backupPollingList = [];
  }
}

// Initialize System Config (loads from file or localStorage)
initializeSystemConfig();

// Copy Cellular Polling commands to Backup Polling list in System Config
const btnCellPollCopyBackup = document.getElementById('btn-cell-poll-copy-backup');
if (btnCellPollCopyBackup) {
  btnCellPollCopyBackup.addEventListener('click', () => {
    const currentCellList = getPollingListFromUI();
    if (currentCellList.length === 0) {
      alert('The Polling Commands List is empty! Nothing to copy.');
      return;
    }
    
    // Map to backup list format (Index and Command)
    backupPollingList = currentCellList.map((item, i) => ({
      Index: item.Index || (i + 1),
      Command: item.Command
    }));
    
    // Save to local storage & file
    saveBackupPollingList();
    
    // Update UI
    rebuildBackupPollingUI();
    
    // Flash visual feedback on the button
    const origText = btnCellPollCopyBackup.textContent;
    btnCellPollCopyBackup.textContent = '✔ Copied!';
    setTimeout(() => {
      btnCellPollCopyBackup.textContent = origText;
    }, 1500);
  });
}


// Helper to format raw hex input with spaces between every byte pair
function formatHexWithSpaces(hexStr) {
  const clean = hexStr.replace(/\s+/g, '');
  const pairs = [];
  for (let i = 0; i < clean.length; i += 2) {
    pairs.push(clean.substring(i, i + 2).toUpperCase());
  }
  return pairs.join(' ');
}

// Helper to get formatted local time as [HH:MM:SS.mmm]
function getFormattedTime() {
  const now = new Date();
  const hrs = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `[${hrs}:${mins}:${secs}.${ms}]`;
}

// Calculate Modbus RTU CRC-16 (Polynomial: 0xA001, Initial: 0xFFFF)
function crc16Modbus(buffer) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >>> 1) ^ 0xA001;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return crc;
}

// Verify if the Modbus RTU packet has a valid CRC-16 checksum
function verifyModbusCRC(bytes) {
  if (bytes.length < 3) return false;
  const calculated = crc16Modbus(bytes.slice(0, -2));
  const receivedLow = bytes[bytes.length - 2];
  const receivedHigh = bytes[bytes.length - 1];
  const received = receivedLow | (receivedHigh << 8);
  return calculated === received;
}

// Convert string to hex space-separated representation
function stringToHex(str) {
  const arr = [];
  for (let i = 0; i < str.length; i++) {
    let hex = str.charCodeAt(i).toString(16).toUpperCase();
    if (hex.length < 2) hex = '0' + hex;
    arr.push(hex);
  }
  return arr.join(' ');
}

// Check if raw data contains DTU notification messages (to be printed in ASCII regardless of hex mode)
function isDtuNotification(str) {
  if (typeof str !== 'string') return false;
  return str.includes('Please check GPRS !!!') || 
         str.includes('+ATK Module Will Restart:') || 
         str.includes('ATK-LTE-DTU');
}

// Global function to determine if a string should be force printed as ASCII
function shouldForceAscii(str) {
  if (typeof str !== 'string') return false;
  if (isDtuNotification(str)) return true;
  
  // Convert incoming text/bytes to clean lowercase hex
  const cleanIncoming = stringToHex(str).replace(/\s+/g, '').toLowerCase();
  if (!cleanIncoming) return false;
  
  // Check against user-defined hex rules
  for (const rule of asciiMatchRules) {
    const cleanRule = rule.replace(/\s+/g, '').toLowerCase();
    if (cleanRule && cleanIncoming.includes(cleanRule)) {
      return true;
    }
  }
  return false;
}

// Convert hex representation back to ASCII string (replacing common control codes with printable representations)
function hexToString(hexStr) {
  if (typeof hexStr !== 'string') return '';
  const clean = hexStr.replace(/\s+/g, '');
  if (!/^[0-9A-Fa-f]+$/.test(clean) || clean.length % 2 !== 0) return '';
  let str = '';
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.substring(i, i + 2), 16);
    if (code === 13) {
      str += '\\r';
    } else if (code === 10) {
      str += '\\n';
    } else if (code === 9) {
      str += '\\t';
    } else if (code >= 32 && code <= 126) {
      str += String.fromCharCode(code);
    } else {
      str += '.';
    }
  }
  return str;
}

class SerialPortSession {
  constructor(deviceUid, info) {
    this.deviceUid = deviceUid;
    this.info = info;
    this.portName = info.port;
    this.isOnline = true;
    this.serialSocket = null;
    this.consoleHistory = [];
    this.lastLineType = '';
    this.lastLineElement = null;
    
    // Create elements by cloning template
    const template = document.getElementById('com-workspace-template');
    const clone = template.content.cloneNode(true);
    
    this.workspaceWrapper = clone.querySelector('.com-workspace-wrapper');
    this.workspaceWrapper.setAttribute('data-uid', deviceUid);
    
    // Find references to components in cloned wrapper
    this.comPortSelect = this.workspaceWrapper.querySelector('.com-port-select');
    this.baudRateSelect = this.workspaceWrapper.querySelector('.baud-rate-select');
    this.dataBitsSelect = this.workspaceWrapper.querySelector('.data-bits-select');
    this.stopBitsSelect = this.workspaceWrapper.querySelector('.stop-bits-select');
    this.paritySelect = this.workspaceWrapper.querySelector('.parity-select');
    this.btnSerialConnect = this.workspaceWrapper.querySelector('.btn-serial-connect');
    this.serialSendInput = this.workspaceWrapper.querySelector('.serial-send-input');
    this.lineEndingSelect = this.workspaceWrapper.querySelector('.line-ending-select');
    this.chkSendHex = this.workspaceWrapper.querySelector('.chk-send-hex');
    this.btnSerialSend = this.workspaceWrapper.querySelector('.btn-serial-send');
    
    this.chkTimeTag = this.workspaceWrapper.querySelector('.chk-time-tag');
    this.chkModbusCrc = this.workspaceWrapper.querySelector('.chk-modbus-crc');
    this.chkRecvHex = this.workspaceWrapper.querySelector('.chk-recv-hex');
    this.chkAutoscroll = this.workspaceWrapper.querySelector('.chk-autoscroll');
    this.btnClearConsole = this.workspaceWrapper.querySelector('.btn-clear-console');
    this.serialConsoleBody = this.workspaceWrapper.querySelector('.serial-console-body');
    
    // Add workspace to dynamic container
    document.getElementById('com-tool-workspaces-container').appendChild(this.workspaceWrapper);
    
    // Default initial options
    this.comPortSelect.innerHTML = `<option value="${this.portName}">${this.portName}</option>`;
    this.comPortSelect.value = this.portName;
    this.comPortSelect.disabled = true;
    
    this.loadSettings();
    this.loadHistory();
    this.setupListeners();
  }

  saveSettings() {
    const settings = {
      baud: this.baudRateSelect.value,
      databits: this.dataBitsSelect.value,
      stopbits: this.stopBitsSelect.value,
      parity: this.paritySelect.value,
      lineending: this.lineEndingSelect.value,
      hexsend: this.chkSendHex.checked,
      hexrecv: this.chkRecvHex.checked,
      autoscroll: this.chkAutoscroll.checked,
      modbuscrc: this.chkModbusCrc.checked,
      timetag: this.chkTimeTag.checked
    };
    localStorage.setItem(`serial_settings_${this.deviceUid}`, JSON.stringify(settings));
  }

  loadSettings() {
    const raw = localStorage.getItem(`serial_settings_${this.deviceUid}`);
    if (raw) {
      try {
        const settings = JSON.parse(raw);
        if (settings.baud) this.baudRateSelect.value = settings.baud;
        if (settings.databits) this.dataBitsSelect.value = settings.databits;
        if (settings.stopbits) this.stopBitsSelect.value = settings.stopbits;
        if (settings.parity) this.paritySelect.value = settings.parity;
        if (settings.lineending) this.lineEndingSelect.value = settings.lineending;
        if (settings.hexsend !== undefined) this.chkSendHex.checked = settings.hexsend;
        if (settings.hexrecv !== undefined) this.chkRecvHex.checked = settings.hexrecv;
        if (settings.autoscroll !== undefined) this.chkAutoscroll.checked = settings.autoscroll;
        if (settings.modbuscrc !== undefined) this.chkModbusCrc.checked = settings.modbuscrc;
        if (settings.timetag !== undefined) this.chkTimeTag.checked = settings.timetag;
      } catch (e) {
        console.error('Failed to load settings for device ' + this.deviceUid, e);
      }
    }
    
    let savedSendInput = localStorage.getItem(`serial_send_input_${this.deviceUid}`);
    if (savedSendInput === null) {
      savedSendInput = localStorage.getItem('serial_send_input');
      if (savedSendInput !== null) {
        localStorage.setItem(`serial_send_input_${this.deviceUid}`, savedSendInput);
      }
    }
    if (savedSendInput !== null) {
      this.serialSendInput.value = savedSendInput;
    }
  }

  saveHistory() {
    const maxHistoryItems = 1000;
    let historyToSave = this.consoleHistory;
    if (this.consoleHistory.length > maxHistoryItems) {
      historyToSave = this.consoleHistory.slice(-maxHistoryItems);
    }
    try {
      localStorage.setItem(`serial_console_history_${this.deviceUid}`, JSON.stringify(historyToSave));
    } catch (e) {
      console.error('Failed to save history for device ' + this.deviceUid, e);
    }
  }

  loadHistory() {
    const raw = localStorage.getItem(`serial_console_history_${this.deviceUid}`);
    if (!raw) return;
    try {
      this.consoleHistory = JSON.parse(raw) || [];
      this.rebuildConsole();
    } catch (e) {
      console.error('Failed to load console history:', e);
    }
  }

  updateLineCRC(lineElement, isSend) {
    const checkEnabled = this.chkModbusCrc.checked;
    const existingBadge = lineElement.querySelector('.crc-badge');
    if (existingBadge) {
      existingBadge.remove();
    }
    if (lineElement.rawText) {
      lineElement.textContent = lineElement.rawText;
    }
    if (!checkEnabled) return;
    const isHexLine = isSend ? !lineElement.classList.contains('text-send') : this.chkRecvHex.checked;
    if (!isHexLine) return;
    const prefix = isSend ? '>> ' : '<< ';
    let rawText = lineElement.rawText || lineElement.textContent;
    const prefixIdx = rawText.indexOf(prefix);
    if (prefixIdx === -1) return;
    let contentText = rawText.substring(prefixIdx + prefix.length).trim();
    const cleanHex = contentText.replace(/\s+/g, '');
    if (/^[0-9A-Fa-f]{6,}$/.test(cleanHex) && cleanHex.length % 2 === 0) {
      const bytes = [];
      for (let i = 0; i < cleanHex.length; i += 2) {
        bytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
      }
      const crcOK = verifyModbusCRC(bytes);
      const badge = document.createElement('span');
      badge.className = `crc-badge ${crcOK ? 'crc-ok' : 'crc-err'}`;
      badge.textContent = crcOK ? 'CRC: OK' : 'CRC: ERR';
      lineElement.appendChild(badge);
    }
  }

  rebuildConsole() {
    if (!this.serialConsoleBody) return;
    this.serialConsoleBody.innerHTML = '';
    let lastType = '';
    let lastEl = null;
    const showHex = this.chkRecvHex.checked;
    const showTime = this.chkTimeTag.checked;
    
    this.consoleHistory.forEach(item => {
      const timePrefix = (showTime && item.timestamp) ? item.timestamp + ' ' : '';
      if (item.type === 'send') {
        const prefix = '>> ';
        let displayText = item.data;
        if (item.isHex) {
          displayText = formatHexWithSpaces(item.data);
        } else {
          if (showHex) {
            displayText = stringToHex(item.data);
          } else {
            displayText = item.data.replace('\r\n', '\\r\\n').replace('\n', '\\n').replace('\r', '\\r');
          }
        }
        const line = document.createElement('div');
        line.className = 'console-line send-msg';
        if (!item.isHex) {
          line.classList.add('text-send');
        }
        line.textContent = timePrefix + prefix + displayText;
        line.rawText = timePrefix + prefix + displayText;
        this.serialConsoleBody.appendChild(line);
        lastEl = line;
        lastType = 'send';
        this.updateLineCRC(line, true);
      } else if (item.type === 'recv') {
        let displayText = item.data;
        if (showHex) {
          displayText = stringToHex(item.data) + ' ';
        }
        let shouldAppend = false;
        if (lastEl && lastType === 'recv') {
          const lastText = lastEl.rawText || lastEl.textContent;
          if (showHex) {
            shouldAppend = true;
          } else {
            if (!lastText.endsWith('\n') && !lastText.endsWith('\r')) {
              shouldAppend = true;
            }
          }
        }
        if (shouldAppend) {
          if (!lastEl.rawText) {
            lastEl.rawText = lastEl.textContent;
          }
          lastEl.rawText += displayText;
          lastEl.textContent = lastEl.rawText;
          this.updateLineCRC(lastEl, false);
        } else {
          const prefix = '<< ';
          const line = document.createElement('div');
          line.className = 'console-line recv-msg';
          line.textContent = timePrefix + prefix + displayText;
          line.rawText = timePrefix + prefix + displayText;
          this.serialConsoleBody.appendChild(line);
          lastEl = line;
          lastType = 'recv';
          this.updateLineCRC(line, false);
        }
      } else {
        const line = document.createElement('div');
        line.className = `console-line ${item.type === 'error' ? 'error-msg' : 'system-msg'}`;
        line.textContent = item.data;
        line.rawText = item.data;
        this.serialConsoleBody.appendChild(line);
        lastEl = line;
        lastType = item.type;
      }
    });
    this.lastLineElement = lastEl;
    this.lastLineType = lastType;
    if (this.chkAutoscroll.checked) {
      this.serialConsoleBody.scrollTop = this.serialConsoleBody.scrollHeight;
    }
  }

  addSendToConsole(text, isHex) {
    const formattedText = isHex ? formatHexWithSpaces(text) : text;
    const timestamp = getFormattedTime();
    this.consoleHistory.push({ type: 'send', data: formattedText, isHex: isHex, timestamp: timestamp });
    this.saveHistory();
    const showTime = this.chkTimeTag.checked;
    const timePrefix = showTime ? timestamp + ' ' : '';
    const prefix = '>> ';
    let displayText = formattedText;
    const showHex = this.chkRecvHex.checked;
    if (isHex) {
      displayText = formattedText;
    } else {
      if (showHex) {
        displayText = stringToHex(formattedText);
      } else {
        displayText = formattedText.replace('\r\n', '\\r\\n').replace('\n', '\\n').replace('\r', '\\r');
      }
    }
    const line = document.createElement('div');
    line.className = 'console-line send-msg';
    if (!isHex) {
      line.classList.add('text-send');
    }
    line.textContent = timePrefix + prefix + displayText;
    line.rawText = timePrefix + prefix + displayText;
    this.serialConsoleBody.appendChild(line);
    this.lastLineElement = line;
    this.lastLineType = 'send';
    this.updateLineCRC(line, true);
    if (this.chkAutoscroll.checked) {
      this.serialConsoleBody.scrollTop = this.serialConsoleBody.scrollHeight;
    }
  }

  addRecvToConsole(text) {
    const timestamp = getFormattedTime();
    this.consoleHistory.push({ type: 'recv', data: text, timestamp: timestamp });
    this.saveHistory();
    const showHex = this.chkRecvHex.checked;
    const showTime = this.chkTimeTag.checked;
    const timePrefix = showTime ? timestamp + ' ' : '';
    let displayText = text;
    if (showHex) {
      displayText = stringToHex(text) + ' ';
    }
    let shouldAppend = false;
    if (this.lastLineElement && this.lastLineType === 'recv') {
      const lastText = this.lastLineElement.rawText || this.lastLineElement.textContent;
      if (showHex) {
        shouldAppend = true;
      } else {
        if (!lastText.endsWith('\n') && !lastText.endsWith('\r')) {
          shouldAppend = true;
        }
      }
    }
    if (shouldAppend) {
      if (!this.lastLineElement.rawText) {
        this.lastLineElement.rawText = this.lastLineElement.textContent;
      }
      this.lastLineElement.rawText += displayText;
      this.lastLineElement.textContent = this.lastLineElement.rawText;
      this.updateLineCRC(this.lastLineElement, false);
    } else {
      const line = document.createElement('div');
      line.className = 'console-line recv-msg';
      line.textContent = timePrefix + '<< ' + displayText;
      line.rawText = timePrefix + '<< ' + displayText;
      this.serialConsoleBody.appendChild(line);
      this.lastLineElement = line;
      this.lastLineType = 'recv';
      this.updateLineCRC(line, false);
    }
    if (this.chkAutoscroll.checked) {
      this.serialConsoleBody.scrollTop = this.serialConsoleBody.scrollHeight;
    }
  }

  addSystemToConsole(text, isError = false) {
    const type = isError ? 'error' : 'system';
    this.consoleHistory.push({ type: type, data: text });
    this.saveHistory();
    const line = document.createElement('div');
    line.className = `console-line ${isError ? 'error-msg' : 'system-msg'}`;
    line.textContent = text;
    line.rawText = text;
    this.serialConsoleBody.appendChild(line);
    this.lastLineElement = line;
    this.lastLineType = type;
    if (this.chkAutoscroll.checked) {
      this.serialConsoleBody.scrollTop = this.serialConsoleBody.scrollHeight;
    }
  }

  setupListeners() {
    this.btnSerialConnect.addEventListener('click', () => {
      this.toggleConnection();
    });
    this.btnSerialSend.addEventListener('click', () => {
      this.sendData();
    });
    this.serialSendInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        this.sendData();
      }
    });
    this.serialSendInput.addEventListener('input', () => {
      localStorage.setItem(`serial_send_input_${this.deviceUid}`, this.serialSendInput.value);
    });
    this.btnClearConsole.addEventListener('click', () => {
      this.serialConsoleBody.innerHTML = '';
      this.consoleHistory = [];
      this.lastLineElement = null;
      this.lastLineType = '';
      localStorage.removeItem(`serial_console_history_${this.deviceUid}`);
    });
    this.baudRateSelect.addEventListener('change', () => this.saveSettings());
    this.dataBitsSelect.addEventListener('change', () => this.saveSettings());
    this.stopBitsSelect.addEventListener('change', () => this.saveSettings());
    this.paritySelect.addEventListener('change', () => this.saveSettings());
    this.lineEndingSelect.addEventListener('change', () => this.saveSettings());
    this.chkSendHex.addEventListener('change', () => this.saveSettings());
    this.chkAutoscroll.addEventListener('change', () => this.saveSettings());
    
    this.chkRecvHex.addEventListener('change', () => {
      this.saveSettings();
      this.rebuildConsole();
    });
    this.chkTimeTag.addEventListener('change', () => {
      this.saveSettings();
      this.rebuildConsole();
    });
    this.chkModbusCrc.addEventListener('change', () => {
      this.saveSettings();
      const lines = this.serialConsoleBody.querySelectorAll('.console-line');
      lines.forEach(line => {
        const isSend = line.classList.contains('send-msg');
        const isRecv = line.classList.contains('recv-msg');
        if (isSend || isRecv) {
          this.updateLineCRC(line, isSend);
        }
      });
    });
  }

  toggleConnection() {
    if (this.serialSocket && this.serialSocket.readyState === WebSocket.OPEN) {
      this.serialSocket.send(JSON.stringify({action: 'close'}));
      this.serialSocket.close();
      return;
    }
    if (!this.isOnline) {
      this.addSystemToConsole('[System] Cannot connect: Device is offline/unplugged.', true);
      return;
    }
    const port = this.portName;
    const baud = this.baudRateSelect.value;
    const bytesize = this.dataBitsSelect.value;
    const stopbits = this.stopBitsSelect.value;
    const parity = this.paritySelect.value;
    this.addSystemToConsole(`[System] Connecting to ${port} at ${baud} baud...`);
    this.btnSerialConnect.disabled = true;
    const wsUrl = `${BASE_URL.replace('http://', 'ws://')}/ws/serial?port=${port}&baud=${baud}&bytesize=${bytesize}&stopbits=${stopbits}&parity=${parity}`;
    
    try {
      this.serialSocket = new WebSocket(wsUrl);
      this.serialSocket.onopen = () => {
        this.btnSerialConnect.disabled = false;
        this.btnSerialConnect.textContent = 'Disconnect Port';
        this.btnSerialConnect.className = 'btn btn-primary btn-serial-connect';
        this.btnSerialConnect.style.background = 'linear-gradient(135deg, var(--danger), #b02a37)';
        this.baudRateSelect.disabled = true;
        this.dataBitsSelect.disabled = true;
        this.stopBitsSelect.disabled = true;
        this.paritySelect.disabled = true;
        this.btnSerialSend.disabled = false;
        this.addSystemToConsole(`[System] Connected to ${port} successfully.`);
        if (typeof markPortOccupationLocally === 'function') {
          markPortOccupationLocally(port, true);
        }
      };
      this.serialSocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'data') {
            this.addRecvToConsole(msg.data);
          } else if (msg.type === 'error') {
            this.addSystemToConsole(`[Error] ${msg.message}`, true);
          }
        } catch (e) {
          this.addSystemToConsole(`[Data Error] Failed to parse backend socket output: ${e.message}`, true);
        }
      };
      this.serialSocket.onclose = () => {
        this.btnSerialConnect.disabled = false;
        this.btnSerialConnect.textContent = 'Connect Port';
        this.btnSerialConnect.className = 'btn btn-primary btn-serial-connect';
        this.btnSerialConnect.style.background = '';
        if (this.isOnline) {
          this.baudRateSelect.disabled = false;
          this.dataBitsSelect.disabled = false;
          this.stopBitsSelect.disabled = false;
          this.paritySelect.disabled = false;
        }
        this.btnSerialSend.disabled = true;
        this.addSystemToConsole(`[System] Disconnected.`);
        this.serialSocket = null;
        if (typeof markPortOccupationLocally === 'function') {
          markPortOccupationLocally(port, false);
        }
      };
      this.serialSocket.onerror = (err) => {
        this.addSystemToConsole(`[System Error] WebSocket error occurred.`, true);
      };
    } catch (err) {
      this.btnSerialConnect.disabled = false;
      this.addSystemToConsole(`[System Error] Failed to open socket: ${err.message}`, true);
    }
  }

  sendData() {
    if (!this.serialSocket || this.serialSocket.readyState !== WebSocket.OPEN) {
      this.addSystemToConsole('[System] Error: Port is not connected.', true);
      return;
    }
    let text = this.serialSendInput.value;
    if (!text) return;
    const isHex = this.chkSendHex.checked;
    if (isHex) {
      const clean = text.replace(/\s+/g, '');
      if (!/^[0-9A-Fa-f]+$/.test(clean)) {
        this.addSystemToConsole('[System] Invalid HEX input! Please enter only hexadecimal characters (0-9, A-F).', true);
        return;
      }
    }
    let displayText = text;
    if (!isHex) {
      const ending = this.lineEndingSelect.value;
      if (ending === 'lf') {
        text += '\n';
        displayText += '\\n';
      } else if (ending === 'cr') {
        text += '\r';
        displayText += '\\r';
      } else if (ending === 'crlf') {
        text += '\r\n';
        displayText += '\\r\\n';
      }
    }
    this.serialSocket.send(JSON.stringify({
      action: 'write',
      data: text,
      hex: isHex
    }));
    this.addSendToConsole(displayText, isHex);
  }

  setOffline() {
    this.isOnline = false;
    this.btnSerialConnect.disabled = true;
    this.baudRateSelect.disabled = true;
    this.dataBitsSelect.disabled = true;
    this.stopBitsSelect.disabled = true;
    this.paritySelect.disabled = true;
    this.btnSerialSend.disabled = true;
    if (this.serialSocket) {
      if (this.serialSocket.readyState === WebSocket.OPEN) {
        this.serialSocket.close();
      }
      this.serialSocket = null;
    }
    const tabEl = document.querySelector(`.com-tab-btn[data-uid="${this.deviceUid}"]`);
    if (tabEl) {
      tabEl.classList.remove('online');
      tabEl.classList.add('offline');
    }
    this.addSystemToConsole(`[System] Hardware connection lost. Device ${this.portName} is offline.`);
  }

  setOnline(info) {
    this.isOnline = true;
    this.info = info;
    this.portName = info.port;
    this.comPortSelect.innerHTML = `<option value="${this.portName}">${this.portName}</option>`;
    this.comPortSelect.value = this.portName;
    this.updateOccupationStatus(info.occupied);
    if (!this.serialSocket) {
      this.baudRateSelect.disabled = false;
      this.dataBitsSelect.disabled = false;
      this.stopBitsSelect.disabled = false;
      this.paritySelect.disabled = false;
    }
    const tabEl = document.querySelector(`.com-tab-btn[data-uid="${this.deviceUid}"]`);
    if (tabEl) {
      tabEl.classList.remove('offline');
      tabEl.classList.add('online');
      const nameEl = tabEl.querySelector('.com-tab-name');
      if (nameEl) {
        nameEl.textContent = this.portName;
      }
    }
    this.addSystemToConsole(`[System] Device ${this.portName} connected (hardware signatures matched).`);
  }

  updateOccupationStatus(occupied) {
    const isConnected = this.serialSocket && (this.serialSocket.readyState === WebSocket.OPEN || this.serialSocket.readyState === WebSocket.CONNECTING);
    if (!isConnected) {
      if (occupied) {
        this.btnSerialConnect.disabled = true;
        this.btnSerialConnect.style.opacity = '0.6';
        this.btnSerialConnect.title = `${this.portName} is occupied by another application or view.`;
      } else {
        if (this.isOnline) {
          this.btnSerialConnect.disabled = false;
        }
        this.btnSerialConnect.style.opacity = '';
        this.btnSerialConnect.title = '';
      }
    } else {
      this.btnSerialConnect.disabled = false;
      this.btnSerialConnect.style.opacity = '';
      this.btnSerialConnect.title = '';
    }
  }

  destroy() {
    if (this.serialSocket) {
      try {
        this.serialSocket.close();
      } catch(e) {}
    }
    if (this.workspaceWrapper && this.workspaceWrapper.parentNode) {
      this.workspaceWrapper.parentNode.removeChild(this.workspaceWrapper);
    }
  }
}

console.log('Renderer boilerplate initialized. Ready for custom components!');;

// ==========================================
// MQTT VIEW & SUB-TABS NAVIGATION
// ==========================================
const subTabBtnInternet = document.getElementById('sub-tab-btn-internet');
const subTabBtnCellular = document.getElementById('sub-tab-btn-cellular');
const subTabBtnPerf = document.getElementById('sub-tab-btn-perf');

const paneInternet = document.getElementById('pane-internet');
const paneCellular = document.getElementById('pane-cellular');
const panePerf = document.getElementById('pane-perf');

function switchMqttSubTab(activeBtn, targetPane) {
  [subTabBtnInternet, subTabBtnCellular, subTabBtnPerf].forEach(btn => btn && btn.classList.remove('active'));
  [paneInternet, paneCellular, panePerf].forEach(pane => pane && pane.classList.remove('active'));
  
  activeBtn.classList.add('active');
  targetPane.classList.add('active');
  
  if (targetPane === panePerf) {
    drawPerformanceChart();
  }
  
  updateSidebarCsqCardVisibility();
}

if (subTabBtnInternet) subTabBtnInternet.addEventListener('click', () => switchMqttSubTab(subTabBtnInternet, paneInternet));
if (subTabBtnCellular) subTabBtnCellular.addEventListener('click', () => switchMqttSubTab(subTabBtnCellular, paneCellular));
if (subTabBtnPerf) subTabBtnPerf.addEventListener('click', () => switchMqttSubTab(subTabBtnPerf, panePerf));


// ==========================================
// INTERNET MQTT CONFIG & SOCKET
// ==========================================
let inetSocket = null;
let inetSubs = {}; // topic -> qos
let inetLogs = [];

const inetBrokerHost = document.getElementById('inet-broker-host');
const inetBrokerPort = document.getElementById('inet-broker-port');
const inetBrokerCid = document.getElementById('inet-broker-cid');
const inetBrokerUser = document.getElementById('inet-broker-user');
const inetBrokerPwd = document.getElementById('inet-broker-pwd');
const btnInetConnect = document.getElementById('btn-inet-connect');

const inetSubTopic = document.getElementById('inet-sub-topic');
const inetSubQos = document.getElementById('inet-sub-qos');
const btnInetSub = document.getElementById('btn-inet-sub');
const inetActiveSubsList = document.getElementById('inet-active-subs-list');

const inetPubTopic = document.getElementById('inet-pub-topic');
const inetPubQos = document.getElementById('inet-pub-qos');
const inetPubPayload = document.getElementById('inet-pub-payload');
const btnInetPub = document.getElementById('btn-inet-pub');

const chkInetTimeTag = document.getElementById('chk-inet-timetag');
const chkInetAutoscroll = document.getElementById('chk-inet-autoscroll');
const chkInetHexMode = document.getElementById('chk-inet-hex-mode');
const chkInetModbusCrc = document.getElementById('chk-inet-modbus-crc');
const btnClearInetConsole = document.getElementById('btn-clear-inet-console');
const inetConsoleBody = document.getElementById('inet-console-body');

// Inet and Cell console log history for persistence and live HEX/CRC re-rendering
let inetConsoleHistory = [];
let cellConsoleHistory = [];

function saveInetConsoleHistory() {
  if (inetConsoleHistory.length > 500) {
    inetConsoleHistory = inetConsoleHistory.slice(-500);
  }
  localStorage.setItem('inet_console_history', JSON.stringify(inetConsoleHistory));
}

function loadInetConsoleHistory() {
  const raw = localStorage.getItem('inet_console_history');
  if (!raw) return;
  try {
    inetConsoleHistory = JSON.parse(raw) || [];
    rebuildInetConsole();
  } catch (e) {
    console.error('Failed to load inet console history:', e);
  }
}

function saveCellConsoleHistory() {
  if (cellConsoleHistory.length > 500) {
    cellConsoleHistory = cellConsoleHistory.slice(-500);
  }
  localStorage.setItem('cell_console_history', JSON.stringify(cellConsoleHistory));
}

function loadCellConsoleHistory() {
  const raw = localStorage.getItem('cell_console_history');
  if (!raw) return;
  try {
    cellConsoleHistory = JSON.parse(raw) || [];
    rebuildCellConsole();
  } catch (e) {
    console.error('Failed to load cell console history:', e);
  }
}

// Load settings from LocalStorage
function loadInetSettings() {
  const settings = JSON.parse(localStorage.getItem('inet_mqtt_settings'));
  if (settings) {
    if (inetBrokerHost && settings.host) inetBrokerHost.value = settings.host;
    if (inetBrokerPort && settings.port) inetBrokerPort.value = settings.port;
    if (inetBrokerCid && settings.cid) inetBrokerCid.value = settings.cid;
    if (inetBrokerUser && settings.user !== undefined) inetBrokerUser.value = settings.user;
    if (inetBrokerPwd && settings.pwd !== undefined) inetBrokerPwd.value = settings.pwd;
    if (inetSubTopic && settings.subTopic) inetSubTopic.value = settings.subTopic;
    if (inetSubQos && settings.subQos) inetSubQos.value = settings.subQos;
    if (inetPubTopic && settings.pubTopic) inetPubTopic.value = settings.pubTopic;
    if (inetPubQos && settings.pubQos) inetPubQos.value = settings.pubQos;
    if (inetPubPayload && settings.pubPayload) inetPubPayload.value = settings.pubPayload;
    if (chkInetTimeTag && settings.timeTag !== undefined) chkInetTimeTag.checked = settings.timeTag;
    if (chkInetAutoscroll && settings.autoscroll !== undefined) chkInetAutoscroll.checked = settings.autoscroll;
    if (chkInetHexMode && settings.hexMode !== undefined) chkInetHexMode.checked = settings.hexMode;
    if (chkInetModbusCrc && settings.modbusCrc !== undefined) chkInetModbusCrc.checked = settings.modbusCrc;
    if (settings.subs !== undefined) {
      inetSubs = settings.subs;
    } else {
      inetSubs = {"nanopd/dtu/tx": 1};
    }
  } else {
    // Default subscriptions
    inetSubs = {"nanopd/dtu/tx": 1};
  }
  rebuildActiveSubsList();
}

function saveInetSettings() {
  const settings = {
    host: inetBrokerHost ? inetBrokerHost.value : '',
    port: inetBrokerPort ? inetBrokerPort.value : 1883,
    cid: inetBrokerCid ? inetBrokerCid.value : '',
    user: inetBrokerUser ? inetBrokerUser.value : '',
    pwd: inetBrokerPwd ? inetBrokerPwd.value : '',
    subTopic: inetSubTopic ? inetSubTopic.value : '',
    subQos: inetSubQos ? inetSubQos.value : 0,
    pubTopic: inetPubTopic ? inetPubTopic.value : '',
    pubQos: inetPubQos ? inetPubQos.value : 0,
    pubPayload: inetPubPayload ? inetPubPayload.value : '',
    timeTag: chkInetTimeTag ? chkInetTimeTag.checked : true,
    autoscroll: chkInetAutoscroll ? chkInetAutoscroll.checked : true,
    hexMode: chkInetHexMode ? chkInetHexMode.checked : false,
    modbusCrc: chkInetModbusCrc ? chkInetModbusCrc.checked : false,
    subs: inetSubs
  };
  localStorage.setItem('inet_mqtt_settings', JSON.stringify(settings));
}

// Format a payload for display based on HEX mode
function formatMqttPayload(rawPayload, hexMode) {
  if (typeof rawPayload !== 'string') return '';
  if (hexMode) {
    return stringToHex(rawPayload);
  }
  // Auto: show hex if binary content detected
  let hasBinary = false;
  for (let i = 0; i < rawPayload.length; i++) {
    const c = rawPayload.charCodeAt(i);
    if ((c < 0x09) || (c > 0x0D && c < 0x20) || c > 0x7E) {
      hasBinary = true;
      break;
    }
  }
  return hasBinary ? stringToHex(rawPayload) : rawPayload;
}

// Attach a CRC badge to a console line element if appropriate
function attachMqttCrcBadge(lineEl, hexStr, crcEnabled) {
  const existing = lineEl.querySelector('.crc-badge');
  if (existing) existing.remove();
  if (!crcEnabled) return;
  const cleanHex = hexStr.replace(/\s+/g, '');
  if (/^[0-9A-Fa-f]{6,}$/.test(cleanHex) && cleanHex.length % 2 === 0) {
    const bytes = [];
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
    }
    if (bytes.length >= 3) {
      const crcOK = verifyModbusCRC(bytes);
      const badge = document.createElement('span');
      badge.className = `crc-badge ${crcOK ? 'crc-ok' : 'crc-err'}`;
      badge.textContent = crcOK ? 'CRC: OK' : 'CRC: ERR';
      lineEl.appendChild(badge);
    }
  }
}

// ============================================================
// MODBUS STREAM ANALYSIS ENGINE
// ============================================================

// FC name table
const MODBUS_FC_NAMES = {
  0x01: 'Read Coils',
  0x02: 'Read Discrete Inputs',
  0x03: 'Read Holding Registers',
  0x04: 'Read Input Registers',
  0x05: 'Write Single Coil',
  0x06: 'Write Single Register',
  0x0F: 'Write Multiple Coils',
  0x10: 'Write Multiple Registers',
};

/**
 * Returns the expected byte-length of a Modbus RTU frame starting at bytes[offset].
 * Returns -1 if not enough data yet, 0 if not a recognised pattern.
 *   type: 'request' | 'response' | 'error'
 */
function modbusFrameLength(bytes, offset, hint) {
  if (offset + 2 > bytes.length) return { len: -1 }; // need more data
  const fc = bytes[offset + 1];
  const isErr = (fc & 0x80) !== 0;

  if (isErr) {
    // Error response: ID FC(|0x80) ExCode CRC_L CRC_H  => 5 bytes
    return { len: 5, type: 'error', fc: fc & 0x7F };
  }

  // REQUEST frames (fixed 8 bytes for FC 01-04, 05, 06; variable for 0F, 10)
  if (hint === 'request') {
    if (fc >= 0x01 && fc <= 0x06) return { len: 8, type: 'request', fc };
    if (fc === 0x0F || fc === 0x10) {
      if (offset + 7 > bytes.length) return { len: -1 };
      const byteCount = bytes[offset + 6];
      return { len: 7 + byteCount + 2, type: 'request', fc };
    }
    return { len: 0 };
  }

  // RESPONSE frames
  if (fc >= 0x01 && fc <= 0x04) {
    // ID FC ByteCount Data... CRC_L CRC_H
    if (offset + 3 > bytes.length) return { len: -1 };
    const byteCount = bytes[offset + 2];
    return { len: 3 + byteCount + 2, type: 'response', fc };
  }
  if (fc === 0x05 || fc === 0x06) {
    return { len: 8, type: 'response', fc };   // echo of request
  }
  if (fc === 0x0F || fc === 0x10) {
    return { len: 8, type: 'response', fc };   // ID FC AddrH AddrL QtyH QtyL CRC_L CRC_H
  }
  return { len: 0 };
}

/**
 * Try to extract ONE Modbus frame starting at bytes[offset].
 * Returns { frame, len } or null.
 * hint: 'request' | 'response' | 'auto'
 */
function tryParseModbusAt(bytes, offset, hint = 'auto') {
  const hints = hint === 'auto' ? ['response', 'request'] : [hint];
  for (const h of hints) {
    const { len, type, fc } = modbusFrameLength(bytes, offset, h) || {};
    if (!len || len < 0) continue;
    if (offset + len > bytes.length) continue;
    const frame = bytes.slice(offset, offset + len);
    const bodyLen = frame.length - 2;
    const calcCrc = crc16Modbus(frame.slice(0, bodyLen));
    const recCrc = frame[bodyLen] | (frame[bodyLen + 1] << 8);
    if (calcCrc === recCrc) {
      return { frame, len, type, fc };
    }
  }
  return null;
}

function getKnownCommandRules() {
  const rules = [];
  
  // 1. POLLING COMMANDS LIST (Primary)
  let pollingList = [];
  if (typeof getPollingListFromUI === 'function') {
    pollingList = getPollingListFromUI();
  }
  
  // Fallback to System Config backup list if Cellular list is empty or Cellular MQTT is not active/connected
  const isCellActive = (typeof cellSocket !== 'undefined' && cellSocket && cellSocket.readyState === WebSocket.OPEN);
  if ((pollingList.length === 0 || !isCellActive) && typeof backupPollingList !== 'undefined') {
    pollingList = backupPollingList;
  }
  
  pollingList.forEach(item => {
    const clean = item.Command.replace(/\s+/g, '').toUpperCase();
    if (/^[0-9A-Fa-f]{6,}$/.test(clean) && clean.length % 2 === 0) {
      const bytes = [];
      for (let i = 0; i < clean.length; i += 2) {
        bytes.push(parseInt(clean.substring(i, i + 2), 16));
      }
      rules.push({
        bytes: bytes,
        prefix: bytes.slice(0, -2),
        reqLen: bytes.length,
        index: item.Index  // 1-based index
      });
    }
  });

  // 2. Secondary COM Connection (MODBUS COMMAND HEX)
  const secondaryCmdInput = document.getElementById('cell-modbus-fallback-cmd');
  if (secondaryCmdInput) {
    const clean = secondaryCmdInput.value.replace(/\s+/g, '').toUpperCase();
    if (/^[0-9A-Fa-f]{6,}$/.test(clean) && clean.length % 2 === 0) {
      const bytes = [];
      for (let i = 0; i < clean.length; i += 2) {
        bytes.push(parseInt(clean.substring(i, i + 2), 16));
      }
      const isDuplicate = rules.some(r => r.bytes.join(',') === bytes.join(','));
      if (!isDuplicate) {
        rules.push({
          bytes: bytes,
          prefix: bytes.slice(0, -2),
          reqLen: bytes.length,
          index: 'secondary'
        });
      }
    }
  }

  // Sort rules by reqLen descending so we match the longest command first
  rules.sort((a, b) => b.reqLen - a.reqLen);
  return rules;
}

/**
 * After the CRC-delay inactivity period, scan the entire accumulated byte buffer
 * and identify Modbus request / response pairs based on known polling commands.
 *
 * Strategy:
 *   Walk byte-by-byte. At each position, test whether any known command prefix
 *   matches. If yes, extract the full request frame, then immediately look for
 *   a matching response frame (same slave-id + FC). Log both with their INDEX.
 *   If the byte doesn't start any known frame, skip it and continue.
 */
const lastMatchedRuleIndices = {
  inet: -1,
  cell: -1
};

function getExpectedResponseLength(ruleBytes) {
  if (!ruleBytes || ruleBytes.length < 6) return 0;
  const fc = ruleBytes[1];
  if (fc >= 0x01 && fc <= 0x04) {
    const qty = (ruleBytes[4] << 8) | ruleBytes[5];
    if (fc === 0x01 || fc === 0x02) {
      const byteCount = Math.ceil(qty / 8);
      return 3 + byteCount + 2;
    } else { // 0x03 or 0x04
      const byteCount = qty * 2;
      return 3 + byteCount + 2;
    }
  }
  if (fc === 0x05 || fc === 0x06 || fc === 0x0F || fc === 0x10) {
    return 8;
  }
  return 0;
}

function analyzeBufferedModbus(buf, consoleBody, timeTagEnabled, consoleType) {
  if (!buf || buf.length === 0) return;

  lastMatchedRuleIndices[consoleType] = -1;
  const consumedTagOffsets = new Set();
  const rules = getKnownCommandRules();
  if (rules.length === 0) {
    addLogToConsole(consoleBody, '[Modbus CRC] Analysis aborted: Polling Commands List is not configured.', 'system', timeTagEnabled);
    return;
  }

  // Sort rules by index to match their polling sequence order
  const rulesBySeq = [...rules].sort((a, b) => {
    const idxA = (a.index !== undefined && a.index !== 'secondary') ? a.index : 9999;
    const idxB = (b.index !== undefined && b.index !== 'secondary') ? b.index : 9999;
    return idxA - idxB;
  });

  // ─── Internet MQTT: Pre-process buffer to strip embedded <N> index tags ───
  let tagIndexAtCleanOffset = {}; // cleanedOffset → parsedIndex (1-based)
  if (consoleType === 'inet') {
    const cleaned = [];
    let i = 0;
    while (i < buf.length) {
      if (buf[i] === 0x3C) {
        // Potential start of <N> tag — peek ahead for digits then 0x3E
        let j = i + 1;
        while (j < buf.length && buf[j] >= 0x30 && buf[j] <= 0x39) j++;
        if (j > i + 1 && j < buf.length && buf[j] === 0x3E) {
          // Valid <N> tag found: decode N and record at the current cleaned position
          const digits = buf.slice(i + 1, j).map(b => String.fromCharCode(b)).join('');
          const parsedN = parseInt(digits, 10);
          if (!isNaN(parsedN)) {
            tagIndexAtCleanOffset[cleaned.length] = parsedN;
          }
          i = j + 1; // skip past '>'
          continue;
        }
      }
      cleaned.push(buf[i]);
      i++;
    }
    buf = cleaned; // replace buf with the tag-stripped version
  }

  let offset = 0;
  let matchCount = 0;

  while (offset < buf.length) {
    // 1. Try to match a known request rule via prefix (standard request/response pair)
    let matchedRule = null;
    for (const rule of rules) {
      const prefix = rule.prefix;
      if (offset + prefix.length <= buf.length) {
        let hit = true;
        for (let b = 0; b < prefix.length; b++) {
          if (buf[offset + b] !== prefix[b]) { hit = false; break; }
        }
        if (hit) { matchedRule = rule; break; }
      }
    }

    if (matchedRule) {
      const { reqLen, index: ruleIndex, prefix } = matchedRule;
      if (offset + reqLen <= buf.length) {
        const reqFrame = buf.slice(offset, offset + reqLen);
        logModbusAnalysis(consoleBody, reqFrame, 'request', timeTagEnabled, consoleType, ruleIndex);
        matchCount++;

        // Update sequence state tracking
        const seqIdx = rulesBySeq.indexOf(matchedRule);
        if (seqIdx !== -1) {
          lastMatchedRuleIndices[consoleType] = seqIdx;
        }

        let advance = reqLen;

        // Try to match corresponding response immediately following the request
        const respStart = offset + reqLen;
        if (respStart + 2 <= buf.length) {
          const rSlaveId = buf[respStart];
          const rFc     = buf[respStart + 1];
          const reqSlaveId = prefix[0];
          const reqFc     = prefix[1];

          if (rSlaveId === reqSlaveId && (rFc === reqFc || rFc === (reqFc | 0x80))) {
            let respLen = 0;
            if (rFc & 0x80) {
              respLen = 5;
            } else if (rFc >= 0x01 && rFc <= 0x04) {
              if (respStart + 3 <= buf.length) {
                respLen = 3 + buf[respStart + 2] + 2;
              }
            } else if (rFc === 0x05 || rFc === 0x06 || rFc === 0x0F || rFc === 0x10) {
              respLen = 8;
            }

            if (respLen > 0 && respStart + respLen <= buf.length) {
              const respFrame = buf.slice(respStart, respStart + respLen);
              // Verify response CRC
              const bodyLen = respFrame.length - 2;
              const calcCrc = crc16Modbus(respFrame.slice(0, bodyLen));
              const recCrc = respFrame[bodyLen] | (respFrame[bodyLen + 1] << 8);
              if (calcCrc === recCrc) {
                logModbusAnalysis(consoleBody, respFrame, 'response', timeTagEnabled, consoleType, ruleIndex);
                advance += respLen;
              }
            }
          }
        }

        offset += advance;
        continue;
      }
    }

    // 2. Standalone response check (useful when requests are not visible in the stream)
    const parsedResp = tryParseModbusAt(buf, offset, 'response');
    if (parsedResp) {
      const respFrame = parsedResp.frame;
      const isErrResp = (respFrame[1] & 0x80) !== 0;
      const fcTarget = respFrame[1] & 0x7F;

      // Find all polling rules compatible with this response structure
      const candidateRules = rulesBySeq.filter(r => {
        const rSlaveId = r.bytes[0];
        const rFc = r.bytes[1];
        const expLen = isErrResp ? 5 : getExpectedResponseLength(r.bytes);
        return rSlaveId === respFrame[0] && rFc === fcTarget && expLen === respFrame.length;
      });

      let chosenRule = null;

      // Priority 1 (Internet MQTT only): use the pre-built tag-offset map.
      // The pre-processor stripped all <N> tags from buf and recorded the cleaned-buffer
      // offset where each tag appeared.
      //
      // Semantic: <N> is a boundary marker inserted by the DTU when it transitions to
      // polling command N.  A response frame that starts at or after <N> (but before
      // <N+1>) belongs to index N.
      //
      // Critical rule: search for any unconsumed tag on or inside the frame first. If not found,
      // fall back to the closest unconsumed tag before the frame. Combine this with sequence guidance
      // to resolve lagging/alignment.
      if (consoleType === 'inet' && Object.keys(tagIndexAtCleanOffset).length > 0) {
        const tagOffsets = Object.keys(tagIndexAtCleanOffset).map(Number).sort((a, b) => a - b);
        
        // Determine the next expected polling sequence index (1-20 wrap-around)
        let expectedIndex = 1;
        if (lastMatchedRuleIndices[consoleType] !== -1) {
          const lastRule = rulesBySeq[lastMatchedRuleIndices[consoleType]];
          if (lastRule && lastRule.index !== undefined && lastRule.index !== 'secondary') {
            expectedIndex = (Number(lastRule.index) % 20) + 1;
          }
        }

        // 1. Search for an unconsumed tag on or inside the current response frame
        let bestTagOffset = -1;
        for (const to of tagOffsets) {
          if (to >= offset && to < offset + respFrame.length && !consumedTagOffsets.has(to)) {
            bestTagOffset = to;
            break; // Use the first tag found inside the frame
          }
        }

        // 2. Fallback to the closest unconsumed tag before the frame
        if (bestTagOffset === -1) {
          for (const to of tagOffsets) {
            if (to < offset && !consumedTagOffsets.has(to)) {
              bestTagOffset = to;
            } else if (to >= offset) {
              break;
            }
          }
        }

        if (bestTagOffset >= 0) {
          // Mark this tag and all prior tags as consumed to prevent them from matching future frames
          for (const to of tagOffsets) {
            if (to <= bestTagOffset) {
              consumedTagOffsets.add(to);
            }
          }
          const tagN = tagIndexAtCleanOffset[bestTagOffset];
          
          // Normalize tagN for wrap-around sequence tracking
          let normalizedTag = tagN;
          if (expectedIndex > 15 && tagN < 5) {
            normalizedTag = tagN + 20;
          }

          // If the normalized tag is greater than expectedIndex, it is a lagged tag.
          // Map it back to N-1 (which maps to expectedIndex or intermediate skipped command).
          let resolvedIndex = normalizedTag;
          if (normalizedTag === expectedIndex + 1) {
            resolvedIndex = normalizedTag - 1;
          }

          if (resolvedIndex > 20) {
            resolvedIndex -= 20;
          }

          chosenRule = candidateRules.find(r => r.index !== undefined && r.index !== 'secondary' && Number(r.index) === resolvedIndex) || null;
          if (chosenRule) {
            const seqIdx = rulesBySeq.indexOf(chosenRule);
            if (seqIdx !== -1) lastMatchedRuleIndices[consoleType] = seqIdx;
          }
        }
      }

      // Priority 2: scan bytes immediately before offset for inline <N> / [N] / N: prefix
      // (used by non-inet consoles or when tagIndexAtCleanOffset map is empty)
      if (!chosenRule) {
        let parsedIndex = null;
        if (offset >= 3) {
          if (buf[offset - 1] === 0x3E) { // '>'
            let idxStart = offset - 2;
            while (idxStart >= 0 && buf[idxStart] >= 0x30 && buf[idxStart] <= 0x39) idxStart--;
            if (idxStart >= 0 && buf[idxStart] === 0x3C) {
              const digits = buf.slice(idxStart + 1, offset - 1).map(b => String.fromCharCode(b)).join('');
              const val = parseInt(digits, 10);
              if (!isNaN(val)) parsedIndex = val;
            }
          }
          if (parsedIndex === null && buf[offset - 1] === 0x5D) { // ']'
            let idxStart = offset - 2;
            while (idxStart >= 0 && buf[idxStart] >= 0x30 && buf[idxStart] <= 0x39) idxStart--;
            if (idxStart >= 0 && buf[idxStart] === 0x5B) {
              const digits = buf.slice(idxStart + 1, offset - 1).map(b => String.fromCharCode(b)).join('');
              const val = parseInt(digits, 10);
              if (!isNaN(val)) parsedIndex = val;
            }
          }
          if (parsedIndex === null && buf[offset - 1] === 0x3A) { // ':'
            let idxStart = offset - 2;
            while (idxStart >= 0 && buf[idxStart] >= 0x30 && buf[idxStart] <= 0x39) idxStart--;
            if (idxStart < offset - 2) {
              const digits = buf.slice(idxStart + 1, offset - 1).map(b => String.fromCharCode(b)).join('');
              const val = parseInt(digits, 10);
              if (!isNaN(val)) parsedIndex = val;
            }
          }
        }
        if (parsedIndex !== null) {
          chosenRule = candidateRules.find(r => r.index !== undefined && r.index.toString() === parsedIndex.toString()) || null;
          if (chosenRule) {
            const seqIdx = rulesBySeq.indexOf(chosenRule);
            if (seqIdx !== -1) lastMatchedRuleIndices[consoleType] = seqIdx;
          }
        }
      }

      // Priority 3: no tag available — assign by sequential counter (uniform-length) or state-tracking
      if (!chosenRule && candidateRules.length > 0) {
        const allSameLength = candidateRules.every(r =>
          getExpectedResponseLength(r.bytes) === getExpectedResponseLength(candidateRules[0].bytes)
        );
        if (allSameLength) {
          const posInCandidates = matchCount % candidateRules.length;
          chosenRule = candidateRules[posInCandidates] || candidateRules[0];
          const seqIdx = rulesBySeq.indexOf(chosenRule);
          if (seqIdx !== -1) lastMatchedRuleIndices[consoleType] = seqIdx;
        } else {
          const candidatesWithSeqIdx = candidateRules.map(r => ({ rule: r, seqIdx: rulesBySeq.indexOf(r) }));
          candidatesWithSeqIdx.sort((a, b) => a.seqIdx - b.seqIdx);
          const lastIdx = lastMatchedRuleIndices[consoleType];
          const nextCandidate = candidatesWithSeqIdx.find(c => c.seqIdx > lastIdx) || candidatesWithSeqIdx[0];
          chosenRule = nextCandidate.rule;
          lastMatchedRuleIndices[consoleType] = nextCandidate.seqIdx;
        }
      }

      logModbusAnalysis(consoleBody, respFrame, 'response', timeTagEnabled, consoleType, chosenRule ? chosenRule.index : undefined);
      matchCount++;
      offset += parsedResp.len;
      continue;
    }


    // 3. Standalone request check
    const parsedReq = tryParseModbusAt(buf, offset, 'request');
    if (parsedReq) {
      const reqFrame = parsedReq.frame;
      const candidateRules = rulesBySeq.filter(r => {
        return r.bytes.length === reqFrame.length && r.bytes.every((b, i) => b === reqFrame[i]);
      });

      let chosenRule = null;
      if (candidateRules.length > 0) {
        chosenRule = candidateRules[0];
        const seqIdx = rulesBySeq.indexOf(chosenRule);
        if (seqIdx !== -1) {
          lastMatchedRuleIndices[consoleType] = seqIdx;
        }
      }

      logModbusAnalysis(consoleBody, reqFrame, 'request', timeTagEnabled, consoleType, chosenRule ? chosenRule.index : undefined);
      matchCount++;
      offset += parsedReq.len;
      continue;
    }

    // 4. Slide window forward
    offset++;
  }

  if (matchCount === 0) {
    addLogToConsole(consoleBody, `[Modbus CRC] No matching Polling command found in ${buf.length} bytes. Please check if Polling Commands List matches the actual transmitted commands.`, 'system', timeTagEnabled);
  }
}

/**
 * Bytes array → compact uppercase hex string (no spaces)
 */
function bytesToHexCompact(bytes) {
  return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/**
 * Bytes array → spaced uppercase hex string
 */
function bytesToHexSpaced(bytes) {
  return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}


// Log a simplified Modbus analysis result (CRC Status only)
// ruleIndex: 1-based index from POLLING COMMANDS LIST, or undefined for secondary COM entries.
function logModbusAnalysis(consoleBody, frame, frameType, timeTagEnabled, consoleType, ruleIndex) {
  const isRequest = (frameType === 'request');
  const baseLabel = isRequest ? '[MODBUS REQUEST]' : '[MODBUS RESPOND]';
  let indexSuffix = '';
  if (ruleIndex === 'secondary') {
    indexSuffix = ' [SECONDARY]';
  } else if (ruleIndex !== undefined && ruleIndex !== null) {
    indexSuffix = ` [INDEX: ${ruleIndex}]`;
  }
  const label = baseLabel + indexSuffix;
  
  // Calculate CRC to verify
  const bodyLen = frame.length - 2;
  const calcCrc = crc16Modbus(frame.slice(0, bodyLen));
  const recCrc = frame[bodyLen] | (frame[bodyLen + 1] << 8);
  const isOk = (calcCrc === recCrc);
  
  // Format CRC as 0xXXXX
  const crcVal = ((frame[frame.length - 1] << 8) | frame[frame.length - 2]).toString(16).toUpperCase().padStart(4, '0');
  const text = `${label} CRC:0x${crcVal}`;
  
  // Add to console log (which returns the line element and records history)
  const lineEl = addLogToConsole(consoleBody, text, 'system', timeTagEnabled);
  if (lineEl) {
    const badge = document.createElement('span');
    badge.className = `crc-badge ${isOk ? 'crc-ok' : 'crc-err'}`;
    badge.textContent = isOk ? 'CRC: OK' : 'CRC: ERR';
    lineEl.appendChild(badge);
  }
  
  // Update the last history item to include crcBadge
  const history = (consoleType === 'inet') ? inetConsoleHistory : cellConsoleHistory;
  if (history.length > 0) {
    history[history.length - 1].crcBadge = isOk ? 'OK' : 'ERR';
  }
  
  if (consoleType === 'inet') {
    saveInetConsoleHistory();
  } else {
    saveCellConsoleHistory();
  }
}

// ── Cellular Modbus CRC accumulator ──────────────────────────────────────────
// All bytes received from the DTU port are appended here, block by block.
// Once Modbus activity stops for longer than the configured CRC Delay,
// the entire accumulated buffer is passed to analyzeBufferedModbus() in one shot.
let cellCrcAccumulator = [];
let cellCrcTimer = null;

/**
 * Core accumulation function.
 * Appends newBytes to cellCrcAccumulator and resets the inactivity timer.
 * Call this for EVERY chunk of bytes that arrives (RX or TX echo).
 */
function cellPushToAccumulator(newBytes) {
  if (!newBytes || newBytes.length === 0) return;

  // Append to the running buffer
  for (let i = 0; i < newBytes.length; i++) cellCrcAccumulator.push(newBytes[i]);
  if (cellCrcAccumulator.length > 16384) {
    cellCrcAccumulator = cellCrcAccumulator.slice(-16384);
  }

  // (Re-)start the inactivity timer
  if (cellCrcTimer) clearTimeout(cellCrcTimer);
  const delayEl = document.getElementById('crc-check-delay');
  const delaySec = delayEl ? parseFloat(delayEl.value) : 10;
  const delayMs  = (isNaN(delaySec) || delaySec <= 0) ? 10000 : delaySec * 1000;

  cellCrcTimer = setTimeout(() => {
    // Take a snapshot and clear the accumulator before analysis
    // so new incoming bytes start a fresh session.
    const snapshot = cellCrcAccumulator.slice();
    cellCrcAccumulator = [];
    const timeTagEnabled = chkCellTimeTag ? chkCellTimeTag.checked : true;
    analyzeBufferedModbus(snapshot, cellConsoleBody, timeTagEnabled, 'cell');
  }, delayMs);
}

/**
 * Called by the RX handler for every data message received from the DTU.
 * Forwards bytes to the shared accumulator when CRC checking is enabled.
 */
function cellAnalyzeBuffer(newBytes, consoleBody, crcEnabled, timeTagEnabled) {
  if (!crcEnabled) return;
  cellPushToAccumulator(newBytes);
}

/**
 * Called when the user manually sends a TX command (hex string).
 * Adds the sent bytes to the accumulator so request + response are analysed
 * together — useful when the DTU does NOT echo TX back as RX.
 */
function cellRecordSentFrame(hexStr) {
  const crcEnabled = chkCellModbusCrc ? chkCellModbusCrc.checked : false;
  if (!crcEnabled) return;
  const clean = hexStr.replace(/\s+/g, '');
  if (!/^[0-9A-Fa-f]+$/.test(clean) || clean.length % 2 !== 0) return;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.substring(i, i + 2), 16));
  cellPushToAccumulator(bytes);
}

// ── Internet MQTT fragment buffer (accumulates hex payload bytes) ─────────────
let inetCrcAccumulator = [];
let inetCrcTimer = null;

function inetPushToAccumulator(newBytes) {
  if (!newBytes || newBytes.length === 0) return;

  for (let i = 0; i < newBytes.length; i++) inetCrcAccumulator.push(newBytes[i]);
  if (inetCrcAccumulator.length > 16384) {
    inetCrcAccumulator = inetCrcAccumulator.slice(-16384);
  }

  if (inetCrcTimer) clearTimeout(inetCrcTimer);
  const delayEl = document.getElementById('crc-check-delay');
  const delaySec = delayEl ? parseFloat(delayEl.value) : 10;
  const delayMs  = (isNaN(delaySec) || delaySec <= 0) ? 10000 : delaySec * 1000;

  inetCrcTimer = setTimeout(() => {
    const snapshot = inetCrcAccumulator.slice();
    inetCrcAccumulator = [];
    const timeTagEnabled = chkInetTimeTag ? chkInetTimeTag.checked : true;
    analyzeBufferedModbus(snapshot, inetConsoleBody, timeTagEnabled, 'inet');
  }, delayMs);
}

/**
 * Called for each RX/TX payload on the inet console.
 * Uses Cellular MQTT Console's decoding method.
 */
function inetAnalyzePayload(rawPayload, consoleBody, crcEnabled, timeTagEnabled, isIncoming = false) {
  if (!crcEnabled) return;

  let newBytes = [];
  if (isIncoming) {
    // Received message from broker: decode using Cellular DTU RX method (raw charCodes)
    for (let i = 0; i < rawPayload.length; i++) {
      newBytes.push(rawPayload.charCodeAt(i) & 0xFF);
    }
  } else {
    // Outgoing publish: follow Cellular DTU TX recording logic (hex or charCodes)
    const clean = rawPayload.replace(/\s+/g, '');
    if (/^[0-9A-Fa-f]+$/.test(clean) && clean.length % 2 === 0) {
      for (let i = 0; i < clean.length; i += 2) {
        newBytes.push(parseInt(clean.substring(i, i + 2), 16));
      }
    } else {
      for (let i = 0; i < rawPayload.length; i++) {
        newBytes.push(rawPayload.charCodeAt(i) & 0xFF);
      }
    }
  }

  inetPushToAccumulator(newBytes);
}

function addLogToConsole(consoleBody, text, type = 'system', timeTagEnabled = true) {
  const timePrefix = timeTagEnabled ? getFormattedTime() + ' ' : '';
  const line = document.createElement('div');
  line.className = 'console-line';
  
  if (type === 'system') line.classList.add('system-msg');
  else if (type === 'send') line.classList.add('send-msg');
  else if (type === 'recv') line.classList.add('recv-msg');
  else if (type === 'error') line.classList.add('error-msg');
  
  line.textContent = timePrefix + text;
  consoleBody.appendChild(line);
  
  // Truncate to keep performance smooth
  if (consoleBody.children.length > 500) {
    consoleBody.removeChild(consoleBody.firstChild);
  }

  // Push to history
  const historyItem = {
    type: type,
    text: text,
    timestamp: timeTagEnabled ? getFormattedTime() : ''
  };

  if (consoleBody === inetConsoleBody) {
    inetConsoleHistory.push(historyItem);
    saveInetConsoleHistory();
  } else if (consoleBody === cellConsoleBody) {
    cellConsoleHistory.push(historyItem);
    saveCellConsoleHistory();
  }
  
  return line;
}

function rebuildActiveSubsList() {
  if (!inetActiveSubsList) return;
  inetActiveSubsList.innerHTML = '';
  
  Object.keys(inetSubs).forEach(topic => {
    const qos = inetSubs[topic];
    const li = document.createElement('li');
    li.className = 'active-sub-item';
    li.innerHTML = `
      <span class="active-sub-topic">${topic} (Q${qos})</span>
      <button class="btn-unsub-mini" data-topic="${topic}">✖</button>
    `;
    inetActiveSubsList.appendChild(li);
  });
  
  // Attach unsub handlers
  inetActiveSubsList.querySelectorAll('.btn-unsub-mini').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const topic = e.target.getAttribute('data-topic');
      if (inetSocket && inetSocket.readyState === WebSocket.OPEN) {
        inetSocket.send(JSON.stringify({ action: 'unsubscribe', topic }));
      }
      delete inetSubs[topic];
      saveInetSettings();
      rebuildActiveSubsList();
    });
  });
}

function connectInetBroker() {
  if (inetSocket && inetSocket.readyState === WebSocket.OPEN) {
    inetSocket.send(JSON.stringify({ action: 'close' }));
    inetSocket.close();
    return;
  }
  
  const host = inetBrokerHost.value;
  const port = inetBrokerPort.value;
  const cid = inetBrokerCid.value;
  const user = inetBrokerUser.value;
  const pwd = inetBrokerPwd.value;
  
  if (!host || !cid) {
    addLogToConsole(inetConsoleBody, '[System] Error: Host address and Client ID are required.', 'error', chkInetTimeTag.checked);
    return;
  }
  
  addLogToConsole(inetConsoleBody, `[System] Connecting to MQTT Broker at ${host}:${port}...`, 'system', chkInetTimeTag.checked);
  btnInetConnect.disabled = true;
  
  const wsUrl = `${BASE_URL.replace('http://', 'ws://')}/ws/mqtt?host=${host}&port=${port}&cid=${cid}&user=${user}&pwd=${pwd}`;
  
  try {
    inetSocket = new WebSocket(wsUrl);
    
    inetSocket.onopen = () => {
      btnInetConnect.disabled = false;
      btnInetConnect.textContent = 'Disconnect Broker';
      btnInetConnect.style.background = 'linear-gradient(135deg, var(--danger), #b02a37)';
      if (btnInetPub) btnInetPub.disabled = false;
      
      // Auto subscribe to active subs list
      Object.keys(inetSubs).forEach(topic => {
        const qos = inetSubs[topic];
        inetSocket.send(JSON.stringify({ action: 'subscribe', topic, qos }));
      });
    };
    
    inetSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'status') {
          if (msg.status === 'connected') {
            setMqttBadgeStatus(true);
            addLogToConsole(inetConsoleBody, '[System] Connected to MQTT Broker successfully.', 'system', chkInetTimeTag.checked);
          } else if (msg.status === 'disconnected') {
            addLogToConsole(inetConsoleBody, '[System] Disconnected from MQTT Broker.', 'system', chkInetTimeTag.checked);
            closeInetSocketUI();
          } else if (msg.status.startsWith('refused')) {
            addLogToConsole(inetConsoleBody, `[System] Connection refused: ${msg.status}`, 'error', chkInetTimeTag.checked);
            closeInetSocketUI();
          }
        } else if (msg.type === 'msg') {
          const hexMode = chkInetHexMode ? chkInetHexMode.checked : false;
          const crcEnabled = chkInetModbusCrc ? chkInetModbusCrc.checked : false;
          const isNotify = shouldForceAscii(msg.payload);
          const displayPayload = isNotify ? msg.payload : formatMqttPayload(msg.payload, hexMode);
          
          // Store raw for live re-rendering
          inetConsoleHistory.push({ type: 'recv', topic: msg.topic, rawPayload: msg.payload, timestamp: getFormattedTime() });
          if (inetConsoleHistory.length > 500) inetConsoleHistory.shift();
          saveInetConsoleHistory();
          
          const timePrefix = chkInetTimeTag && chkInetTimeTag.checked ? getFormattedTime() + ' ' : '';
          const line = document.createElement('div');
          line.className = 'console-line recv-msg';
          line.textContent = `${timePrefix}<< [${msg.topic}] ${displayPayload}`;
          line.dataset.rawPayload = msg.payload;
          line.dataset.topic = msg.topic;
          inetConsoleBody.appendChild(line);
          
          if (crcEnabled) {
            inetAnalyzePayload(msg.payload, inetConsoleBody, crcEnabled, chkInetTimeTag && chkInetTimeTag.checked, true);
          }
          
          if (inetConsoleBody.children.length > 500) {
            inetConsoleBody.removeChild(inetConsoleBody.firstChild);
          }
          
          // Performance latency tracking
          performanceTracker.registerInternetMsg(msg.payload);
          
          if (chkInetAutoscroll && chkInetAutoscroll.checked) {
            inetConsoleBody.scrollTop = inetConsoleBody.scrollHeight;
          }
        } else if (msg.type === 'log') {
          addLogToConsole(inetConsoleBody, `[Broker Log] ${msg.message}`, 'system', chkInetTimeTag.checked);
        } else if (msg.type === 'error') {
          addLogToConsole(inetConsoleBody, `[Error] ${msg.message}`, 'error', chkInetTimeTag.checked);
        }
      } catch (err) {
        console.error('Failed to parse Internet MQTT socket message:', err);
      }
    };
    
    inetSocket.onclose = () => {
      closeInetSocketUI();
    };
    
    inetSocket.onerror = (err) => {
      addLogToConsole(inetConsoleBody, '[System Error] WebSocket error occurred.', 'error', chkInetTimeTag.checked);
      closeInetSocketUI();
    };
    
  } catch (err) {
    btnInetConnect.disabled = false;
    addLogToConsole(inetConsoleBody, `[System Error] Failed to open socket: ${err.message}`, 'error', chkInetTimeTag.checked);
  }
}

function closeInetSocketUI() {
  setMqttBadgeStatus(false);
  btnInetConnect.disabled = false;
  btnInetConnect.textContent = 'Connect Broker';
  btnInetConnect.style.background = '';
  if (btnInetPub) btnInetPub.disabled = true;
  inetSocket = null;
}

if (btnInetConnect) btnInetConnect.addEventListener('click', connectInetBroker);

if (btnInetSub) {
  btnInetSub.addEventListener('click', () => {
    const topic = inetSubTopic.value.trim();
    const qos = parseInt(inetSubQos.value);
    if (!topic) return;
    
    if (inetSocket && inetSocket.readyState === WebSocket.OPEN) {
      inetSocket.send(JSON.stringify({ action: 'subscribe', topic, qos }));
    }
    
    inetSubs[topic] = qos;
    saveInetSettings();
    rebuildActiveSubsList();
  });
}

if (btnInetPub) {
  btnInetPub.addEventListener('click', () => {
    const topic = inetPubTopic.value.trim();
    const qos = parseInt(inetPubQos.value);
    const payload = inetPubPayload.value;
    if (!topic) return;
    
    if (inetSocket && inetSocket.readyState === WebSocket.OPEN) {
      inetSocket.send(JSON.stringify({ action: 'publish', topic, payload, qos }));
      const timePrefix = chkInetTimeTag && chkInetTimeTag.checked ? getFormattedTime() + ' ' : '';
      const line = document.createElement('div');
      line.className = 'console-line send-msg';
      line.textContent = `${timePrefix}>> [${topic}] ${payload}`;
      inetConsoleBody.appendChild(line);

      inetConsoleHistory.push({ type: 'send', topic: topic, payload: payload, timestamp: getFormattedTime() });
      saveInetConsoleHistory();

      const crcEnabled = chkInetModbusCrc ? chkInetModbusCrc.checked : false;
      if (crcEnabled) {
        inetAnalyzePayload(payload, inetConsoleBody, crcEnabled, chkInetTimeTag && chkInetTimeTag.checked);
      }

      if (inetConsoleBody.children.length > 500) inetConsoleBody.removeChild(inetConsoleBody.firstChild);
      if (chkInetAutoscroll && chkInetAutoscroll.checked) {
        inetConsoleBody.scrollTop = inetConsoleBody.scrollHeight;
      }
    }
  });
}

if (btnClearInetConsole) {
  btnClearInetConsole.addEventListener('click', () => {
    inetConsoleBody.innerHTML = '';
    inetConsoleHistory = [];
    localStorage.removeItem('inet_console_history');
  });
}

// Helper: extract plain text from a console body element
function getConsoleText(consoleBodyEl) {
  const lines = consoleBodyEl.querySelectorAll('.console-line');
  const parts = [];
  lines.forEach(line => {
    // Use rawText if available (stripped of CRC badges), else textContent
    let text = line.rawText || line.textContent;
    // Remove any trailing CRC badge text if it slipped through
    const badge = line.querySelector('.crc-badge');
    if (badge && !line.rawText) {
      text = text.replace(badge.textContent, '').trim();
    }
    parts.push(text);
  });
  return parts.join('\n');
}

// Helper: copy text to clipboard and briefly flash button
function flashCopyIcon(btn) {
  const origText = btn.textContent;
  btn.textContent = '✔';
  btn.classList.add('copied-flash');
  setTimeout(() => {
    btn.textContent = origText;
    btn.classList.remove('copied-flash');
  }, 1500);
}

const btnCopyInetConsole = document.getElementById('btn-copy-inet-console');
if (btnCopyInetConsole) {
  btnCopyInetConsole.addEventListener('click', async () => {
    const inetText = getConsoleText(inetConsoleBody);
    try {
      await navigator.clipboard.writeText(inetText);
      flashCopyIcon(btnCopyInetConsole);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  });
}

// Debugging Tool card button listeners
const btnDebugClearAll = document.getElementById('btn-debug-clear-all');
if (btnDebugClearAll) {
  btnDebugClearAll.addEventListener('click', () => {
    // Clear Internet MQTT Console
    inetConsoleBody.innerHTML = '';
    inetConsoleHistory = [];
    localStorage.removeItem('inet_console_history');

    // Clear Cellular MQTT Console
    cellConsoleBody.innerHTML = '';
    cellConsoleHistory = [];
    localStorage.removeItem('cell_console_history');

    // Visual feedback
    const origText = btnDebugClearAll.textContent;
    btnDebugClearAll.textContent = '✔ Consoles Cleared!';
    setTimeout(() => {
      btnDebugClearAll.textContent = origText;
    }, 1500);
  });
}

const btnDebugSaveAll = document.getElementById('btn-debug-save-all');
if (btnDebugSaveAll) {
  btnDebugSaveAll.addEventListener('click', async () => {
    const inetText = getConsoleText(inetConsoleBody);
    const cellText = getConsoleText(cellConsoleBody);

    const logContent = 
      `=== intrenet mqtt ===\n` +
      inetText +
      `\n\n=== cellular mqtt ===\n` +
      cellText + '\n';

    if (window.electronAPI && window.electronAPI.writeMqttLog) {
      const res = await window.electronAPI.writeMqttLog(logContent);
      if (res && res.ok) {
        // Visual feedback
        const origText = btnDebugSaveAll.textContent;
        btnDebugSaveAll.textContent = '✔ Logs Saved!';
        btnDebugSaveAll.classList.add('saved-flash');
        setTimeout(() => {
          btnDebugSaveAll.textContent = origText;
          btnDebugSaveAll.classList.remove('saved-flash');
        }, 1500);
      } else {
        alert('Failed to save logs: ' + (res ? res.error : 'Unknown error'));
      }
    }
  });
}

const btnDebugConnectAll = document.getElementById('btn-debug-connect-all');
if (btnDebugConnectAll) {
  btnDebugConnectAll.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.logRendererError) {
      window.electronAPI.logRendererError('[DebugConnectAll] Clicked!');
    }
    // 1. Internet MQTT Connect Broker
    const btnInet = document.getElementById('btn-inet-connect');
    if (btnInet) {
      if (window.electronAPI && window.electronAPI.logRendererError) {
        window.electronAPI.logRendererError(`[DebugConnectAll] btnInet text: "${btnInet.textContent}", disabled: ${btnInet.disabled}`);
      }
      if (btnInet.textContent.trim() === 'Connect Broker') {
        btnInet.click();
      }
    }

    // 2. Cellular MQTT Secondary COM Connection
    const btnCellModbus = document.getElementById('btn-cell-modbus-connect');
    if (btnCellModbus) {
      if (window.electronAPI && window.electronAPI.logRendererError) {
        window.electronAPI.logRendererError(`[DebugConnectAll] btnCellModbus text: "${btnCellModbus.textContent}", disabled: ${btnCellModbus.disabled}`);
      }
      if (btnCellModbus.textContent.trim() === 'Connect Port') {
        btnCellModbus.click();
      }
    }

    // 3. Cellular MQTT Cellular COM Connection
    const btnCell = document.getElementById('btn-cell-connect');
    if (btnCell) {
      if (window.electronAPI && window.electronAPI.logRendererError) {
        window.electronAPI.logRendererError(`[DebugConnectAll] btnCell text: "${btnCell.textContent}", disabled: ${btnCell.disabled}`);
      }
      if (btnCell.textContent.trim() === 'Connect Port') {
        btnCell.click();
      }
    }

    // Visual feedback
    const origText = btnDebugConnectAll.textContent;
    btnDebugConnectAll.textContent = '✔ Connecting All...';
    setTimeout(() => {
      btnDebugConnectAll.textContent = origText;
    }, 1500);
  });
}

// Rebuild inet console lines when HEX mode or CRC check changes
function rebuildInetConsole() {
  inetConsoleBody.innerHTML = '';
  const hexMode = chkInetHexMode ? chkInetHexMode.checked : false;
  const crcEnabled = chkInetModbusCrc ? chkInetModbusCrc.checked : false;
  const showTime = chkInetTimeTag ? chkInetTimeTag.checked : true;

  inetConsoleHistory.forEach(item => {
    const timePrefix = showTime ? (item.timestamp || getFormattedTime()) + ' ' : '';
    const line = document.createElement('div');
    line.className = 'console-line';

    if (item.type === 'recv') {
      line.classList.add('recv-msg');
      if (item.rawPayload !== undefined) {
        const isNotify = shouldForceAscii(item.rawPayload);
        const displayPayload = isNotify ? item.rawPayload : formatMqttPayload(item.rawPayload, hexMode);
        line.textContent = `${timePrefix}<< [${item.topic}] ${displayPayload}`;
        line.dataset.rawPayload = item.rawPayload;
        line.dataset.topic = item.topic;
      } else {
        line.textContent = `${timePrefix}${item.text || ''}`;
      }
      inetConsoleBody.appendChild(line);
    } else if (item.type === 'send') {
      line.classList.add('send-msg');
      if (item.payload !== undefined) {
        line.textContent = `${timePrefix}>> [${item.topic}] ${item.payload}`;
      } else {
        line.textContent = `${timePrefix}${item.text || ''}`;
      }
      inetConsoleBody.appendChild(line);
    } else if (item.type === 'system' || item.type === 'error') {
      line.classList.add(item.type === 'error' ? 'error-msg' : 'system-msg');
      line.textContent = `${timePrefix}${item.text}`;
      inetConsoleBody.appendChild(line);
      
      if (item.crcBadge && crcEnabled) {
        const badge = document.createElement('span');
        badge.className = `crc-badge ${item.crcBadge === 'OK' ? 'crc-ok' : 'crc-err'}`;
        badge.textContent = `CRC: ${item.crcBadge}`;
        line.appendChild(badge);
      }
    }
  });

  if (chkInetAutoscroll && chkInetAutoscroll.checked) {
    inetConsoleBody.scrollTop = inetConsoleBody.scrollHeight;
  }
}

if (chkInetHexMode) {
  chkInetHexMode.addEventListener('change', () => {
    saveInetSettings();
    rebuildInetConsole();
  });
}
if (chkInetModbusCrc) {
  chkInetModbusCrc.addEventListener('change', () => {
    saveInetSettings();
    rebuildInetConsole();
  });
}

[inetBrokerHost, inetBrokerPort, inetBrokerCid, inetBrokerUser, inetBrokerPwd, inetSubTopic, inetSubQos, inetPubTopic, inetPubQos, inetPubPayload].forEach(el => {
  if (el) el.addEventListener('change', saveInetSettings);
});
if (chkInetTimeTag) {
  chkInetTimeTag.addEventListener('change', () => {
    saveInetSettings();
    rebuildInetConsole();
  });
}
if (chkInetAutoscroll) {
  chkInetAutoscroll.addEventListener('change', saveInetSettings);
}


// ==========================================
// CELLULAR MQTT (DTU CONFIG)
// ==========================================
let cellSocket = null;
let cellModbusSocket = null;
let cellModbusFallbackTimerId = null;
let lastCellModbusTrafficTime = 0;
let cellModbusPortRxBuffer = [];
let cellModbusSentCommandBytes = null;
let cellModbusManualCommandBytes = null;
let cellFallbackRxBuffer = [];
let cellAutoCsqTimerId = null;
let isCellAutoCsqQuerying = false;
const cellPortSelect = document.getElementById('cell-port-select');
const cellBaudSelect = document.getElementById('cell-baud-select');
const cellDataBitsSelect = document.getElementById('cell-data-bits-select');
const cellStopBitsSelect = document.getElementById('cell-stop-bits-select');
const cellParitySelect = document.getElementById('cell-parity-select');
const btnCellConnect = document.getElementById('btn-cell-connect');
const btnCellRefreshCsq = document.getElementById('btn-cell-refresh-csq');
const btnCellReload = document.getElementById('btn-cell-reload');
const btnCellReboot = document.getElementById('btn-cell-reboot');

const cellBrokerIp = document.getElementById('cell-broker-ip');
const cellBrokerPort = document.getElementById('cell-broker-port');
const cellBrokerCid = document.getElementById('cell-broker-cid');
const cellBrokerUser = document.getElementById('cell-broker-user');
const cellBrokerPwd = document.getElementById('cell-broker-pwd');
const btnCellApplyMode = document.getElementById('btn-cell-apply-mode');

const cellDtuBaud = document.getElementById('cell-dtu-baud');
const cellDtuData = document.getElementById('cell-dtu-data');
const cellDtuStop = document.getElementById('cell-dtu-stop');
const cellDtuParity = document.getElementById('cell-dtu-parity');
const btnCellReloadUart = document.getElementById('btn-cell-reload-uart');
const btnCellApplyUart = document.getElementById('btn-cell-apply-uart');

const btnCellReloadSubs = document.getElementById('btn-cell-reload-subs');
const btnCellApplySubs = document.getElementById('btn-cell-apply-subs');

const btnCellReloadPubs = document.getElementById('btn-cell-reload-pubs');
const btnCellApplyPubs = document.getElementById('btn-cell-apply-pubs');

const cellWillEn = document.getElementById('cell-will-en');
const cellWillTopic = document.getElementById('cell-will-topic');
const cellWillMsg = document.getElementById('cell-will-msg');
const cellWillQos = document.getElementById('cell-will-qos');
const cellWillRetain = document.getElementById('cell-will-retain');
const btnCellApplyWill = document.getElementById('btn-cell-apply-will');

const cellCleanSession = document.getElementById('cell-clean-session');
const cellKeepAlive = document.getElementById('cell-keep-alive');
const btnCellReloadMqttcon = document.getElementById('btn-cell-reload-mqttcon');
const btnCellApplyMqttcon = document.getElementById('btn-cell-apply-mqttcon');

const cellModbusIdHex = document.getElementById('cell-modbus-id-hex');
const cellModbusIdDec = document.getElementById('cell-modbus-id-dec');
const cellModbusFunc = document.getElementById('cell-modbus-func');
const cellModbusAddrHex = document.getElementById('cell-modbus-addr-hex');
const cellModbusAddrDec = document.getElementById('cell-modbus-addr-dec');
const cellModbusQty = document.getElementById('cell-modbus-qty');
const modbusGenHexDisplay = document.getElementById('modbus-gen-hex-display');
const btnCellPubModbus = document.getElementById('btn-cell-pub-modbus');

const cellTaskCycle = document.getElementById('cell-task-cycle');
const cellTaskInterval = document.getElementById('cell-task-interval');
const cellTaskDistEn = document.getElementById('cell-task-dist-en');
const cellTaskDistFmt = document.getElementById('cell-task-dist-fmt');
const btnCellReloadPoll = document.getElementById('btn-cell-reload-poll');
const btnCellApplyPoll = document.getElementById('btn-cell-apply-poll');
const btnCellPollAdd = document.getElementById('btn-cell-poll-add');
const pollingCommandsTable = document.getElementById('polling-commands-table') ? document.getElementById('polling-commands-table').querySelector('tbody') : null;

const btnCellCheckNet = document.getElementById('btn-cell-check-net');

const chkCellTimeTag = document.getElementById('chk-cell-timetag');
const chkCellAutoscroll = document.getElementById('chk-cell-autoscroll');
const chkCellHexMode = document.getElementById('chk-cell-hex-mode');
const chkCellModbusCrc = document.getElementById('chk-cell-modbus-crc');
const btnClearCellConsole = document.getElementById('btn-clear-cell-console');
const cellConsoleBody = document.getElementById('cell-console-body');
const cellConsoleSendInput = document.getElementById('cell-console-send-input');
const btnCellConsoleSend = document.getElementById('btn-cell-console-send');
const cellLineEndingSelect = document.getElementById('cell-line-ending-select');

let cellPreferredPort = '';

// Load/Save Cellular settings from localstorage
function loadCellSettings() {
  const settings = JSON.parse(localStorage.getItem('cell_mqtt_settings'));
  if (settings) {
    if (cellBaudSelect && settings.baud) cellBaudSelect.value = settings.baud;
    if (cellDataBitsSelect && settings.dataBits) cellDataBitsSelect.value = settings.dataBits;
    if (cellStopBitsSelect && settings.stopBits) cellStopBitsSelect.value = settings.stopBits;
    if (cellParitySelect && settings.parity) cellParitySelect.value = settings.parity;
    if (cellBrokerIp && settings.brokerIp) cellBrokerIp.value = settings.brokerIp;
    if (cellBrokerPort && settings.brokerPort) cellBrokerPort.value = settings.brokerPort;
    if (cellBrokerCid && settings.brokerCid) cellBrokerCid.value = settings.brokerCid;
    if (cellBrokerUser && settings.brokerUser !== undefined) cellBrokerUser.value = settings.brokerUser;
    if (cellBrokerPwd && settings.brokerPwd !== undefined) cellBrokerPwd.value = settings.brokerPwd;
    if (cellDtuBaud && settings.dtuBaud) cellDtuBaud.value = settings.dtuBaud;
    if (cellDtuData && settings.dtuData) cellDtuData.value = settings.dtuData;
    if (cellDtuStop && settings.dtuStop) cellDtuStop.value = settings.dtuStop;
    if (cellDtuParity && settings.dtuParity) cellDtuParity.value = settings.dtuParity;
    
    if (settings.subsList) {
      settings.subsList.forEach((sub, i) => {
        const en = document.getElementById(`cell-sub-en-${i}`);
        const t = document.getElementById(`cell-sub-t-${i}`);
        const q = document.getElementById(`cell-sub-q-${i}`);
        if (en) en.checked = sub.en;
        if (t) t.value = sub.topic;
        if (q) q.value = sub.qos;
      });
    }
    
    if (settings.pubsList) {
      settings.pubsList.forEach((pub, i) => {
        const en = document.getElementById(`cell-pub-en-${i}`);
        const t = document.getElementById(`cell-pub-t-${i}`);
        const q = document.getElementById(`cell-pub-q-${i}`);
        const r = document.getElementById(`cell-pub-r-${i}`);
        if (en) en.checked = pub.en;
        if (t) t.value = pub.topic;
        if (q) q.value = pub.qos;
        if (r) r.checked = pub.retain;
      });
    }

    if (cellWillEn && settings.willEn !== undefined) cellWillEn.checked = settings.willEn;
    if (cellWillTopic && settings.willTopic) cellWillTopic.value = settings.willTopic;
    if (cellWillMsg && settings.willMsg) cellWillMsg.value = settings.willMsg;
    if (cellWillQos && settings.willQos) cellWillQos.value = settings.willQos;
    if (cellWillRetain && settings.willRetain !== undefined) cellWillRetain.checked = settings.willRetain;
    if (cellCleanSession && settings.cleanSession !== undefined) cellCleanSession.checked = settings.cleanSession;
    if (cellKeepAlive && settings.keepAlive) cellKeepAlive.value = settings.keepAlive;
    
    if (cellModbusIdHex && settings.modbusIdHex) cellModbusIdHex.value = settings.modbusIdHex;
    if (cellModbusIdDec && settings.modbusIdDec) cellModbusIdDec.value = settings.modbusIdDec;
    if (cellModbusFunc && settings.modbusFunc) cellModbusFunc.value = settings.modbusFunc;
    if (cellModbusAddrHex && settings.modbusAddrHex) cellModbusAddrHex.value = settings.modbusAddrHex;
    if (cellModbusAddrDec && settings.modbusAddrDec) cellModbusAddrDec.value = settings.modbusAddrDec;
    if (cellModbusQty && settings.modbusQty) cellModbusQty.value = settings.modbusQty;
    
    if (cellTaskCycle && settings.taskCycle) cellTaskCycle.value = settings.taskCycle;
    if (cellTaskInterval && settings.taskInterval) cellTaskInterval.value = settings.taskInterval;
    if (cellTaskDistEn && settings.taskDistEn !== undefined) cellTaskDistEn.checked = settings.taskDistEn;
    if (cellTaskDistFmt && settings.taskDistFmt) cellTaskDistFmt.value = settings.taskDistFmt;
    if (cellLineEndingSelect && settings.lineEnding) cellLineEndingSelect.value = settings.lineEnding;
    if (chkCellTimeTag && settings.timeTag !== undefined) chkCellTimeTag.checked = settings.timeTag;
    if (chkCellAutoscroll && settings.autoscroll !== undefined) chkCellAutoscroll.checked = settings.autoscroll;
    if (chkCellHexMode && settings.hexMode !== undefined) chkCellHexMode.checked = settings.hexMode;
    if (chkCellModbusCrc && settings.modbusCrc !== undefined) chkCellModbusCrc.checked = settings.modbusCrc;
    
    const autoCsqEnInput = document.getElementById('cell-auto-csq-en');
    const autoCsqIntervalInput = document.getElementById('cell-auto-csq-interval');
    if (autoCsqEnInput && settings.autoCsqEn !== undefined) autoCsqEnInput.checked = settings.autoCsqEn;
    if (autoCsqIntervalInput && settings.autoCsqInterval) autoCsqIntervalInput.value = settings.autoCsqInterval;
    
    cellPreferredPort = settings.port || 'COM6';
  } else {
    cellPreferredPort = 'COM6';
  }
}

function saveCellSettings() {
  const subsList = [];
  for (let i = 0; i < 4; i++) {
    const en = document.getElementById(`cell-sub-en-${i}`);
    const t = document.getElementById(`cell-sub-t-${i}`);
    const q = document.getElementById(`cell-sub-q-${i}`);
    subsList.push({
      en: en ? en.checked : false,
      topic: t ? t.value : '',
      qos: q ? parseInt(q.value) : 0
    });
  }
  
  const pubsList = [];
  for (let i = 0; i < 4; i++) {
    const en = document.getElementById(`cell-pub-en-${i}`);
    const t = document.getElementById(`cell-pub-t-${i}`);
    const q = document.getElementById(`cell-pub-q-${i}`);
    const r = document.getElementById(`cell-pub-r-${i}`);
    pubsList.push({
      en: en ? en.checked : false,
      topic: t ? t.value : '',
      qos: q ? parseInt(q.value) : 0,
      retain: r ? r.checked : false
    });
  }

  const settings = {
    port: cellPortSelect ? cellPortSelect.value : '',
    baud: cellBaudSelect ? cellBaudSelect.value : 115200,
    dataBits: cellDataBitsSelect ? cellDataBitsSelect.value : 8,
    stopBits: cellStopBitsSelect ? cellStopBitsSelect.value : 1,
    parity: cellParitySelect ? cellParitySelect.value : 'None',
    brokerIp: cellBrokerIp ? cellBrokerIp.value : '',
    brokerPort: cellBrokerPort ? cellBrokerPort.value : '',
    brokerCid: cellBrokerCid ? cellBrokerCid.value : '',
    brokerUser: cellBrokerUser ? cellBrokerUser.value : '',
    brokerPwd: cellBrokerPwd ? cellBrokerPwd.value : '',
    dtuBaud: cellDtuBaud ? cellDtuBaud.value : 115200,
    dtuData: cellDtuData ? cellDtuData.value : 8,
    dtuStop: cellDtuStop ? cellDtuStop.value : 1,
    dtuParity: cellDtuParity ? cellDtuParity.value : 'None',
    subsList,
    pubsList,
    willEn: cellWillEn ? cellWillEn.checked : false,
    willTopic: cellWillTopic ? cellWillTopic.value : '',
    willMsg: cellWillMsg ? cellWillMsg.value : '',
    willQos: cellWillQos ? cellWillQos.value : 0,
    willRetain: cellWillRetain ? cellWillRetain.checked : false,
    cleanSession: cellCleanSession ? cellCleanSession.checked : true,
    keepAlive: cellKeepAlive ? cellKeepAlive.value : 60,
    modbusIdHex: cellModbusIdHex ? cellModbusIdHex.value : '',
    modbusIdDec: cellModbusIdDec ? cellModbusIdDec.value : '',
    modbusFunc: cellModbusFunc ? cellModbusFunc.value : '03',
    modbusAddrHex: cellModbusAddrHex ? cellModbusAddrHex.value : '',
    modbusAddrDec: cellModbusAddrDec ? cellModbusAddrDec.value : '',
    modbusQty: cellModbusQty ? cellModbusQty.value : '',
    taskCycle: cellTaskCycle ? cellTaskCycle.value : '',
    taskInterval: cellTaskInterval ? cellTaskInterval.value : '',
    taskDistEn: cellTaskDistEn ? cellTaskDistEn.checked : false,
    taskDistFmt: cellTaskDistFmt ? cellTaskDistFmt.value : '',
    lineEnding: cellLineEndingSelect ? cellLineEndingSelect.value : 'crlf',
    timeTag: chkCellTimeTag ? chkCellTimeTag.checked : true,
    autoscroll: chkCellAutoscroll ? chkCellAutoscroll.checked : true,
    hexMode: chkCellHexMode ? chkCellHexMode.checked : false,
    modbusCrc: chkCellModbusCrc ? chkCellModbusCrc.checked : false,
    autoCsqEn: document.getElementById('cell-auto-csq-en') ? document.getElementById('cell-auto-csq-en').checked : false,
    autoCsqInterval: document.getElementById('cell-auto-csq-interval') ? parseInt(document.getElementById('cell-auto-csq-interval').value) : 10
  };
  localStorage.setItem('cell_mqtt_settings', JSON.stringify(settings));
}

/**
 * Check if a byte array contains recognisable Modbus activity.
 * Matches against known polling command prefixes (any rule in getKnownCommandRules).
 * Used to detect active Modbus traffic so the Auto CSQ timer can be postponed.
 */
function hasModbusActivity(bytes) {
  const rules = getKnownCommandRules();
  if (rules.length === 0 || !bytes || bytes.length === 0) return false;
  for (const rule of rules) {
    const prefix = rule.prefix;
    if (bytes.length >= prefix.length) {
      // Scan through bytes to see if the prefix appears anywhere
      for (let start = 0; start <= bytes.length - prefix.length; start++) {
        let match = true;
        for (let j = 0; j < prefix.length; j++) {
          if (bytes[start + j] !== prefix[j]) { match = false; break; }
        }
        if (match) return true;
      }
    }
  }
  return false;
}

/**
 * Restart the Auto CSQ interval timer from zero (deferred).
 * Called whenever Modbus activity is detected, so that AT+CSQ is
 * not sent until a full quiet interval has passed after Modbus stops.
 */
function postponeCellAutoCsqPolling() {
  const autoCsqEn = document.getElementById('cell-auto-csq-en');
  if (!autoCsqEn || !autoCsqEn.checked) return;
  if (!cellSocket || cellSocket.readyState !== WebSocket.OPEN) return;
  // Restart the interval from scratch (deferred — no immediate poll)
  startCellAutoCsqPolling(true);
}

/**
 * Start the Auto CSQ polling interval.
 * @param {boolean} [deferred=false] - If true, skip the initial immediate poll
 *   and just wait the full interval. Used when restarting after Modbus activity.
 */
function startCellAutoCsqPolling(deferred = false) {
  stopCellAutoCsqPolling(); // Clean up first
  
  const intervalInput = document.getElementById('cell-auto-csq-interval');
  let seconds = parseInt(intervalInput.value);
  if (isNaN(seconds) || seconds < 1) {
    seconds = 10;
    if (intervalInput) intervalInput.value = 10;
  }
  
  const poll = () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      if (!isCellAutoCsqQuerying) {
        isCellAutoCsqQuerying = true;
        cellSocket.send(JSON.stringify({ action: 'query_csq' }));
      }
    } else {
      stopCellAutoCsqPolling();
      const toggle = document.getElementById('cell-auto-csq-en');
      if (toggle) toggle.checked = false;
    }
  };
  
  if (!deferred) {
    // Perform first check immediately on normal start
    poll();
  }
  
  // Set interval (always)
  cellAutoCsqTimerId = setInterval(poll, seconds * 1000);
}

function stopCellAutoCsqPolling() {
  if (cellAutoCsqTimerId) {
    clearInterval(cellAutoCsqTimerId);
    cellAutoCsqTimerId = null;
  }
  isCellAutoCsqQuerying = false;
}

// Load/Save Modbus port fallback settings
let cellModbusPreferredPort = '';

function loadCellModbusSettings() {
  const settings = JSON.parse(localStorage.getItem('cell_modbus_settings'));
  const portSelect = document.getElementById('cell-modbus-port-select');
  const baudSelect = document.getElementById('cell-modbus-baud-select');
  const dataBitsSelect = document.getElementById('cell-modbus-data-bits-select');
  const stopBitsSelect = document.getElementById('cell-modbus-stop-bits-select');
  const paritySelect = document.getElementById('cell-modbus-parity-select');
  const timeoutInput = document.getElementById('cell-modbus-timeout');
  const cmdInput = document.getElementById('cell-modbus-fallback-cmd');

  if (settings) {
    if (baudSelect && settings.baud) baudSelect.value = settings.baud;
    if (dataBitsSelect && settings.dataBits) dataBitsSelect.value = settings.dataBits;
    if (stopBitsSelect && settings.stopBits) stopBitsSelect.value = settings.stopBits;
    if (paritySelect && settings.parity) paritySelect.value = settings.parity;
    if (timeoutInput && settings.timeout) timeoutInput.value = settings.timeout;
    if (cmdInput && settings.fallbackCmd) cmdInput.value = settings.fallbackCmd;
    cellModbusPreferredPort = settings.port || 'COM3';
  } else {
    cellModbusPreferredPort = 'COM3';
  }
}

function saveCellModbusSettings() {
  const portSelect = document.getElementById('cell-modbus-port-select');
  const baudSelect = document.getElementById('cell-modbus-baud-select');
  const dataBitsSelect = document.getElementById('cell-modbus-data-bits-select');
  const stopBitsSelect = document.getElementById('cell-modbus-stop-bits-select');
  const paritySelect = document.getElementById('cell-modbus-parity-select');
  const timeoutInput = document.getElementById('cell-modbus-timeout');
  const cmdInput = document.getElementById('cell-modbus-fallback-cmd');

  const settings = {
    port: portSelect ? portSelect.value : '',
    baud: baudSelect ? baudSelect.value : '115200',
    dataBits: dataBitsSelect ? dataBitsSelect.value : '8',
    stopBits: stopBitsSelect ? stopBitsSelect.value : '1',
    parity: paritySelect ? paritySelect.value : 'None',
    timeout: timeoutInput ? timeoutInput.value : '5',
    fallbackCmd: cmdInput ? cmdInput.value : '01 03 00 00 00 0A C5 CD'
  };

  localStorage.setItem('cell_modbus_settings', JSON.stringify(settings));
}

function checkCellPortOccupation() {
  const details = lastDetails || {};
  
  // 1. Check cell-port-select
  const cellPortSelect = document.getElementById('cell-port-select');
  const btnCellConnect = document.getElementById('btn-cell-connect');
  if (cellPortSelect && btnCellConnect) {
    const isConnected = cellSocket && cellSocket.readyState === WebSocket.OPEN;
    const isConnecting = cellSocket && cellSocket.readyState === WebSocket.CONNECTING;
    if (!isConnected && !isConnecting) {
      const selectedPort = cellPortSelect.value;
      const info = details[selectedPort] || {};
      if (info.occupied) {
        btnCellConnect.disabled = true;
        btnCellConnect.style.opacity = '0.6';
        btnCellConnect.title = `${selectedPort} is occupied by another application.`;
      } else {
        btnCellConnect.disabled = false;
        btnCellConnect.style.opacity = '';
        btnCellConnect.title = '';
      }
    } else {
      btnCellConnect.disabled = false;
      btnCellConnect.style.opacity = '';
      btnCellConnect.title = '';
    }
  }
  
  // 2. Check cell-modbus-port-select
  const modbusPortSelect = document.getElementById('cell-modbus-port-select');
  const btnCellModbusConnect = document.getElementById('btn-cell-modbus-connect');
  if (modbusPortSelect && btnCellModbusConnect) {
    const isConnected = cellModbusSocket && cellModbusSocket.readyState === WebSocket.OPEN;
    const isConnecting = cellModbusSocket && cellModbusSocket.readyState === WebSocket.CONNECTING;
    const btnSend = document.getElementById('btn-cell-modbus-send');
    if (btnSend) {
      btnSend.disabled = !isConnected;
    }
    if (!isConnected && !isConnecting) {
      const selectedPort = modbusPortSelect.value;
      const info = details[selectedPort] || {};
      if (info.occupied) {
        btnCellModbusConnect.disabled = true;
        btnCellModbusConnect.style.opacity = '0.6';
        btnCellModbusConnect.title = `${selectedPort} is occupied by another application.`;
      } else {
        btnCellModbusConnect.disabled = false;
        btnCellModbusConnect.style.opacity = '';
        btnCellModbusConnect.title = '';
      }
    } else {
      btnCellModbusConnect.disabled = false;
      btnCellModbusConnect.style.opacity = '';
      btnCellModbusConnect.title = '';
    }
  }
}

function markPortOccupationLocally(port, occupied) {
  if (!port) return;
  if (!lastDetails) {
    lastDetails = {};
  }
  if (!lastDetails[port]) {
    lastDetails[port] = {
      port: port,
      name: `Serial Port (${port})`,
      manufacturer: "------",
      vid: "------",
      pid: "------",
      ser: "------"
    };
  }
  lastDetails[port].occupied = occupied;
  
  // Immediately update occupation checks in UI
  checkCellPortOccupation();
  
  // Immediately update COM tool tab occupation status
  activeSessions.forEach((session) => {
    if (session.portName === port && session.isOnline) {
      session.updateOccupationStatus(occupied);
    }
  });

  // Instantly rebuild top card badges to show correct color
  if (lastPorts && typeof rebuildComPortBadges === 'function') {
    rebuildComPortBadges(lastPorts, lastDetails);
  }
}

function updateCellPortsDropdown(ports, details = {}) {
  if (!cellPortSelect) return;
  if (cellSocket && cellSocket.readyState === WebSocket.OPEN) return;
  
  const currentSelection = cellPortSelect.value || cellPreferredPort;
  cellPortSelect.innerHTML = '';
  
  if (ports.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No Active Ports';
    cellPortSelect.appendChild(opt);
    checkCellPortOccupation();
    return;
  }
  
  ports.forEach(port => {
    const opt = document.createElement('option');
    opt.value = port;
    const info = details[port] || {};
    const occupiedSuffix = info.occupied ? ' (Occupied)' : '';
    opt.textContent = port + occupiedSuffix;
    if (port === currentSelection) opt.selected = true;
    cellPortSelect.appendChild(opt);
  });
  
  if (!ports.includes(currentSelection)) {
    cellPortSelect.selectedIndex = 0;
  }
  checkCellPortOccupation();
}

function updateCellModbusPortsDropdown(ports, details = {}) {
  const portSelect = document.getElementById('cell-modbus-port-select');
  if (!portSelect) return;
  if (cellModbusSocket && cellModbusSocket.readyState === WebSocket.OPEN) return;

  const currentSelection = portSelect.value || cellModbusPreferredPort;
  portSelect.innerHTML = '';

  if (ports.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No Active Ports';
    portSelect.appendChild(opt);
    checkCellPortOccupation();
    return;
  }

  ports.forEach(port => {
    const opt = document.createElement('option');
    opt.value = port;
    const info = details[port] || {};
    const occupiedSuffix = info.occupied ? ' (Occupied)' : '';
    opt.textContent = port + occupiedSuffix;
    if (port === currentSelection) opt.selected = true;
    portSelect.appendChild(opt);
  });

  if (!ports.includes(currentSelection)) {
    portSelect.selectedIndex = 0;
  }
  checkCellPortOccupation();
}

// Hook into existing serial ports polling in renderer.js
const originalUpdateComPortDropdown = updateComPortDropdown;
updateComPortDropdown = function(ports, details) {
  originalUpdateComPortDropdown(ports, details);
  updateCellPortsDropdown(ports, details);
  updateCellModbusPortsDropdown(ports, details);
};

function connectCellularDTU() {
  if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
    cellSocket.send(JSON.stringify({ action: 'close' }));
    cellSocket.close();
    return;
  }
  
  const port = cellPortSelect.value;
  const baud = cellBaudSelect.value;
  const bytesize = cellDataBitsSelect.value;
  const stopbits = cellStopBitsSelect.value;
  const parity = cellParitySelect.value === 'None' ? 'N' : cellParitySelect.value[0];
  
  if (!port) {
    addLogToConsole(cellConsoleBody, '[System] Error: No COM port selected.', 'error', chkCellTimeTag.checked);
    return;
  }
  
  addLogToConsole(cellConsoleBody, `[System] Connecting to Cellular DTU on ${port} at ${baud} baud...`, 'system', chkCellTimeTag.checked);
  btnCellConnect.disabled = true;
  toggleCellSettingsDisable(true);
  
  const wsUrl = `${BASE_URL.replace('http://', 'ws://')}/ws/cellular?port=${port}&baud=${baud}&bytesize=${bytesize}&stopbits=${stopbits}&parity=${parity}`;
  
  try {
    cellSocket = new WebSocket(wsUrl);
    
    cellSocket.onopen = () => {
      btnCellConnect.disabled = false;
      btnCellConnect.textContent = 'Disconnect Port';
      btnCellConnect.style.background = 'linear-gradient(135deg, var(--danger), #b02a37)';
      
      toggleCellControlButtons(true);
      addLogToConsole(cellConsoleBody, `[System] DTU Serial Port connected successfully. Ready.`, 'system', chkCellTimeTag.checked);
      
      // Auto read all HW settings upon connection
      if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
        cellSocket.send(JSON.stringify({ action: 'provision' }));
      }
      
      if (typeof markPortOccupationLocally === 'function') {
        markPortOccupationLocally(port, true);
      }

      const autoCsqEn = document.getElementById('cell-auto-csq-en');
      if (autoCsqEn && autoCsqEn.checked) {
        // Start polling but defer the first query since the provision process already queries CSQ
        startCellAutoCsqPolling(true);
      }

      // Reset traffic state and timers on connect
      lastCellModbusTrafficTime = 0;
      if (cellModbusFallbackTimerId) {
        clearTimeout(cellModbusFallbackTimerId);
        cellModbusFallbackTimerId = null;
      }

      startFallbackTimerIfActive();
    };
    
    cellSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const hexMode = chkCellHexMode ? chkCellHexMode.checked : false;
        const crcEnabled = chkCellModbusCrc ? chkCellModbusCrc.checked : false;
        
        if (msg.type === 'data') {
          // Postpone Auto CSQ query whenever any data is received
          postponeCellAutoCsqPolling();
          let displayData = msg.data;
          const isNotify = shouldForceAscii(msg.data);
          
          if (hexMode && !isNotify) {
            displayData = stringToHex(msg.data);
          } else {
            // Auto: if data looks like a compact hex string, format with spaces
            const cleanHex = msg.data.replace(/\s+/g, '');
            if (!isNotify && /^[0-9A-Fa-f]{6,}$/.test(cleanHex) && cleanHex.length % 2 === 0) {
              displayData = formatHexWithSpaces(cleanHex);
            }
          }
          
          const timePrefix = chkCellTimeTag && chkCellTimeTag.checked ? getFormattedTime() + ' ' : '';
          const line = document.createElement('div');
          line.className = 'console-line recv-msg';
          line.textContent = `${timePrefix}<< ${displayData}`;
          line.dataset.rawData = msg.data;
          cellConsoleBody.appendChild(line);
          
          cellConsoleHistory.push({ type: 'recv', data: msg.data, timestamp: getFormattedTime() });
          saveCellConsoleHistory();
          
          if (cellConsoleBody.children.length > 500) cellConsoleBody.removeChild(cellConsoleBody.firstChild);
          
          const bytes = [];
          for (let i = 0; i < msg.data.length; i++) {
            bytes.push(msg.data.charCodeAt(i) & 0xFF);
          }
          detectFallbackTraffic(bytes);
          const modbusPackets = findModbusPackets(bytes);
          modbusPackets.forEach(pkt => {
            performanceTracker.registerCellularMsg(pkt);
          });
          
          // Postpone Auto CSQ query if Modbus activity is detected on RX
          if (hasModbusActivity(bytes)) {
            postponeCellAutoCsqPolling();
          }
          
          if (crcEnabled) {
            cellAnalyzeBuffer(bytes, cellConsoleBody, crcEnabled, chkCellTimeTag && chkCellTimeTag.checked);
          }
          
          if (chkCellAutoscroll && chkCellAutoscroll.checked) {
            cellConsoleBody.scrollTop = cellConsoleBody.scrollHeight;
          }
        } else if (msg.type === 'log') {
          let logType = 'system';
          let prefix = '';
          if (msg.direction === 'TX') { logType = 'send'; prefix = '>> '; }
          else if (msg.direction === 'RX') { logType = 'recv'; prefix = '<< '; }
          
          addLogToConsole(cellConsoleBody, `${prefix}${msg.message}`, logType, chkCellTimeTag.checked);
          if (chkCellAutoscroll && chkCellAutoscroll.checked) {
            cellConsoleBody.scrollTop = cellConsoleBody.scrollHeight;
          }
          
          if (msg.message && msg.message.includes('Reboot')) {
            const btnReboot = document.getElementById('btn-cell-reboot');
            if (btnReboot) {
              btnReboot.disabled = false;
              btnReboot.textContent = 'Reboot';
            }
          }
        } else if (msg.type === 'hw_state') {
          loadHwStateIntoUI(msg.state);
          const btnReload = document.getElementById('btn-cell-reload');
          if (btnReload) {
            btnReload.disabled = false;
            btnReload.textContent = 'Reload';
          }
        } else if (msg.type === 'network_info') {
          loadNetworkInfoIntoUI(msg.data);
        } else if (msg.type === 'csq_info') {
          isCellAutoCsqQuerying = false;
          if (btnCellRefreshCsq) {
            btnCellRefreshCsq.disabled = false;
            btnCellRefreshCsq.textContent = 'Query CSQ Now';
          }
          const csqVal = msg.csq || 'N/A';
          const displayEl = document.getElementById('cell-auto-csq-display');
          if (displayEl) displayEl.textContent = csqVal;
          const netCsqEl = document.getElementById('net-info-csq');
          if (netCsqEl) netCsqEl.textContent = csqVal;
        } else if (msg.type === 'error') {
          isCellAutoCsqQuerying = false;
          if (btnCellRefreshCsq) {
            btnCellRefreshCsq.disabled = false;
            btnCellRefreshCsq.textContent = 'Query CSQ Now';
          }
          const btnReload = document.getElementById('btn-cell-reload');
          if (btnReload) {
            btnReload.disabled = false;
            btnReload.textContent = 'Reload';
          }
          const btnReboot = document.getElementById('btn-cell-reboot');
          if (btnReboot) {
            btnReboot.disabled = false;
            btnReboot.textContent = 'Reboot';
          }
          addLogToConsole(cellConsoleBody, `[Error] ${msg.message}`, 'error', chkCellTimeTag.checked);
        }
      } catch (err) {
        console.error('Failed to parse Cellular DTU message:', err);
      }
    };
    
    cellSocket.onclose = () => {
      closeCellSocketUI();
    };
    
    cellSocket.onerror = (err) => {
      addLogToConsole(cellConsoleBody, '[System Error] WebSocket error occurred.', 'error', chkCellTimeTag.checked);
      closeCellSocketUI();
    };
  } catch (err) {
    btnCellConnect.disabled = false;
    toggleCellSettingsDisable(false);
    addLogToConsole(cellConsoleBody, `[System Error] Failed to open socket: ${err.message}`, 'error', chkCellTimeTag.checked);
  }
}

function isCellModbusFallbackActive() {
  return cellSocket && cellSocket.readyState === WebSocket.OPEN &&
         cellModbusSocket && cellModbusSocket.readyState === WebSocket.OPEN;
}

function connectCellModbusPort() {
  if (window.electronAPI && window.electronAPI.logRendererError) {
    window.electronAPI.logRendererError('[connectCellModbusPort] Invoked!');
  }
  const btn = document.getElementById('btn-cell-modbus-connect');
  if (!btn) return;

  if (cellModbusSocket && cellModbusSocket.readyState === WebSocket.OPEN) {
    cellModbusSocket.send(JSON.stringify({ action: 'close' }));
    cellModbusSocket.close();
    return;
  }

  const portSelect = document.getElementById('cell-modbus-port-select');
  const baudSelect = document.getElementById('cell-modbus-baud-select');
  const dataBitsSelect = document.getElementById('cell-modbus-data-bits-select');
  const stopBitsSelect = document.getElementById('cell-modbus-stop-bits-select');
  const paritySelect = document.getElementById('cell-modbus-parity-select');

  const port = portSelect.value;
  const baud = baudSelect.value;
  const bytesize = dataBitsSelect.value;
  const stopbits = stopBitsSelect.value;
  const parity = paritySelect.value === 'None' ? 'N' : paritySelect.value[0];

  if (!port) {
    if (window.electronAPI && window.electronAPI.logRendererError) {
      window.electronAPI.logRendererError('[connectCellModbusPort] Error: No Modbus COM port selected.');
    }
    addLogToConsole(cellConsoleBody, '[System] Error: No Modbus COM port selected.', 'error', chkCellTimeTag.checked);
    return;
  }

  if (window.electronAPI && window.electronAPI.logRendererError) {
    window.electronAPI.logRendererError(`[connectCellModbusPort] Connecting to port: ${port} @ ${baud}`);
  }

  addLogToConsole(cellConsoleBody, `[System] Connecting to Modbus COM Port on ${port} at ${baud} baud...`, 'system', chkCellTimeTag.checked);
  btn.disabled = true;

  const wsUrl = `${BASE_URL.replace('http://', 'ws://')}/ws/serial?port=${port}&baud=${baud}&bytesize=${bytesize}&stopbits=${stopbits}&parity=${parity}`;

  try {
    cellModbusSocket = new WebSocket(wsUrl);

    cellModbusSocket.onopen = () => {
      btn.disabled = false;
      btn.textContent = 'Disconnect Port';
      btn.style.background = 'linear-gradient(135deg, var(--danger), #b02a37)';

      portSelect.disabled = true;
      baudSelect.disabled = true;
      dataBitsSelect.disabled = true;
      stopBitsSelect.disabled = true;
      paritySelect.disabled = true;

      addLogToConsole(cellConsoleBody, `[System] Modbus COM Port connected successfully. Ready.`, 'system', chkCellTimeTag.checked);
      
      const btnSend = document.getElementById('btn-cell-modbus-send');
      if (btnSend) btnSend.disabled = false;

      saveCellModbusSettings();

      if (typeof markPortOccupationLocally === 'function') {
        markPortOccupationLocally(port, true);
      }

      // Reset traffic state and timers on connect
      lastCellModbusTrafficTime = 0;
      if (cellModbusFallbackTimerId) {
        clearTimeout(cellModbusFallbackTimerId);
        cellModbusFallbackTimerId = null;
      }

      startFallbackTimerIfActive();
    };

    cellModbusSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          postponeCellAutoCsqPolling();
          handleCellModbusPortMessage(msg.data);
        } else if (msg.type === 'error') {
          addLogToConsole(cellConsoleBody, `[Modbus Port Error] ${msg.message}`, 'error', chkCellTimeTag.checked);
        }
      } catch (err) {
        console.error('Failed to parse Modbus Port message:', err);
      }
    };

    cellModbusSocket.onclose = () => {
      closeCellModbusPortUI();
    };

    cellModbusSocket.onerror = (err) => {
      addLogToConsole(cellConsoleBody, '[System Error] Modbus Port WebSocket error occurred.', 'error', chkCellTimeTag.checked);
      closeCellModbusPortUI();
    };
  } catch (err) {
    btn.disabled = false;
    addLogToConsole(cellConsoleBody, `[System Error] Failed to open Modbus Port socket: ${err.message}`, 'error', chkCellTimeTag.checked);
  }
}

function closeCellModbusPortUI() {
  const btn = document.getElementById('btn-cell-modbus-connect');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Connect Port';
    btn.style.background = '';
  }

  const portSelect = document.getElementById('cell-modbus-port-select');
  const baudSelect = document.getElementById('cell-modbus-baud-select');
  const dataBitsSelect = document.getElementById('cell-modbus-data-bits-select');
  const stopBitsSelect = document.getElementById('cell-modbus-stop-bits-select');
  const paritySelect = document.getElementById('cell-modbus-parity-select');

  const port = portSelect ? portSelect.value : '';

  if (portSelect) portSelect.disabled = false;
  if (baudSelect) baudSelect.disabled = false;
  if (dataBitsSelect) dataBitsSelect.disabled = false;
  if (stopBitsSelect) stopBitsSelect.disabled = false;
  if (paritySelect) paritySelect.disabled = false;

  addLogToConsole(cellConsoleBody, `[System] Modbus COM Port disconnected.`, 'system', chkCellTimeTag.checked);

  const btnSend = document.getElementById('btn-cell-modbus-send');
  if (btnSend) btnSend.disabled = true;

  cellModbusSocket = null;
  cellModbusPortRxBuffer = [];
  cellModbusSentCommandBytes = null;
  cellModbusManualCommandBytes = null;
  if (cellModbusFallbackTimerId) {
    clearTimeout(cellModbusFallbackTimerId);
    cellModbusFallbackTimerId = null;
  }
  lastCellModbusTrafficTime = 0;
  
  if (port && typeof markPortOccupationLocally === 'function') {
    markPortOccupationLocally(port, false);
  } else {
    checkCellPortOccupation();
  }
}

function handleCellModbusPortMessage(dataStr) {
  // Convert received string data to bytes
  const bytes = [];
  for (let i = 0; i < dataStr.length; i++) {
    bytes.push(dataStr.charCodeAt(i) & 0xFF);
  }

  cellModbusPortRxBuffer.push(...bytes);
  if (cellModbusPortRxBuffer.length > 512) {
    cellModbusPortRxBuffer = cellModbusPortRxBuffer.slice(-512);
  }

  let buf = cellModbusPortRxBuffer;
  let offset = 0;

  while (offset < buf.length) {
    const parsed = tryParseModbusAt(buf, offset, 'response');
    if (parsed) {
      console.log(`[Fallback Monitor] Received response from Modbus Port: ${bytesToHexSpaced(parsed.frame)}`);
      
      // Send both the command and response out via COM6 if we actually sent a command via fallback
      if (cellSocket && cellSocket.readyState === WebSocket.OPEN && cellModbusSentCommandBytes) {
        const cmdBytes = cellModbusSentCommandBytes;
        const respBytes = parsed.frame;

        // Send command
        cellSocket.send(JSON.stringify({
          action: 'write',
          data: bytesToHexCompact(cmdBytes),
          hex: true
        }));
        
        // Send response
        cellSocket.send(JSON.stringify({
          action: 'write',
          data: bytesToHexCompact(respBytes),
          hex: true
        }));

        // Log and print on Cellular MQTT console
        const timePrefix = chkCellTimeTag && chkCellTimeTag.checked ? getFormattedTime() + ' ' : '';
        
        // Command line
        const cmdText = `${bytesToHexSpaced(cmdBytes)}`;
        addLogToConsole(cellConsoleBody, `>> ${cmdText}`, 'send', chkCellTimeTag.checked);

        // Response line
        const respText = `${bytesToHexSpaced(respBytes)}`;
        addLogToConsole(cellConsoleBody, `>> ${respText}`, 'send', chkCellTimeTag.checked);

        // Feed to standard Modbus analyzer (CRC check accumulator) if enabled
        const crcEnabled = chkCellModbusCrc ? chkCellModbusCrc.checked : false;
        if (crcEnabled) {
          cellPushToAccumulator(cmdBytes);
          cellPushToAccumulator(respBytes);
        }

        if (chkCellAutoscroll && chkCellAutoscroll.checked) {
          cellConsoleBody.scrollTop = cellConsoleBody.scrollHeight;
        }
      }

      if (cellModbusManualCommandBytes) {
        const respBytes = parsed.frame;
        const respText = `${bytesToHexSpaced(respBytes)}`;
        const portSelect = document.getElementById('cell-modbus-port-select');
        const portName = portSelect ? portSelect.value : 'COM';
        addLogToConsole(cellConsoleBody, `<< [${portName} RX] ${respText}`, 'recv', chkCellTimeTag.checked);

        // Feed to standard Modbus analyzer (CRC check accumulator) if enabled
        const crcEnabled = chkCellModbusCrc ? chkCellModbusCrc.checked : false;
        if (crcEnabled) {
          cellPushToAccumulator(cellModbusManualCommandBytes);
          cellPushToAccumulator(respBytes);
        }

        if (chkCellAutoscroll && chkCellAutoscroll.checked) {
          cellConsoleBody.scrollTop = cellConsoleBody.scrollHeight;
        }

        cellModbusManualCommandBytes = null;
      }

      offset += parsed.len;
      cellModbusSentCommandBytes = null;
    } else {
      const { len } = modbusFrameLength(buf, offset, 'response') || {};
      if (len === -1 || (len > 0 && offset + len > buf.length)) {
        break; // Need more data
      }
      offset++;
    }
  }

  if (offset > 0) {
    cellModbusPortRxBuffer = buf.slice(offset);
  }
}

function sendCellModbusManualRequest() {
  if (!cellModbusSocket || cellModbusSocket.readyState !== WebSocket.OPEN) {
    addLogToConsole(cellConsoleBody, `[Secondary COM Error] Socket is not open.`, 'error', chkCellTimeTag.checked);
    return;
  }

  const cmdInput = document.getElementById('cell-modbus-fallback-cmd');
  const cmdHex = cmdInput ? cmdInput.value.trim() : '';
  if (!cmdHex) {
    addLogToConsole(cellConsoleBody, `[Secondary COM Error] No Modbus command specified.`, 'error', chkCellTimeTag.checked);
    return;
  }

  const cleanHex = cmdHex.replace(/\s+/g, '');
  if (!/^[0-9A-Fa-f]+$/.test(cleanHex) || cleanHex.length % 2 !== 0) {
    addLogToConsole(cellConsoleBody, `[Secondary COM Error] Invalid HEX command: ${cmdHex}`, 'error', chkCellTimeTag.checked);
    return;
  }

  // Parse command bytes
  const bytes = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
  }
  cellModbusManualCommandBytes = bytes;

  // Log send to Cellular MQTT console
  const portSelect = document.getElementById('cell-modbus-port-select');
  const portName = portSelect ? portSelect.value : 'COM';
  const displaySendHex = bytesToHexSpaced(bytes);
  addLogToConsole(cellConsoleBody, `>> [${portName} TX] ${displaySendHex}`, 'send', chkCellTimeTag.checked);

  // Send to secondary COM port
  console.log(`[Secondary COM Manual] Sending command to Modbus Port: ${cleanHex}`);
  cellModbusSocket.send(JSON.stringify({
    action: 'write',
    data: cleanHex,
    hex: true
  }));
}

function triggerModbusFallbackAction() {
  if (!isCellModbusFallbackActive()) return;

  if (isCellAutoCsqQuerying) {
    console.log("[Fallback Monitor] Postponing fallback action because CSQ query is active.");
    const timeoutSec = parseFloat(document.getElementById('cell-modbus-timeout').value) || 5;
    if (cellModbusFallbackTimerId) clearTimeout(cellModbusFallbackTimerId);
    cellModbusFallbackTimerId = setTimeout(() => {
      triggerModbusFallbackAction();
    }, timeoutSec * 1000);
    return;
  }

  const cmdInput = document.getElementById('cell-modbus-fallback-cmd');
  const cmdHex = cmdInput ? cmdInput.value.trim() : '';
  if (!cmdHex) {
    console.warn("[Fallback Monitor] No fallback command specified.");
    return;
  }

  const cleanHex = cmdHex.replace(/\s+/g, '');
  if (!/^[0-9A-Fa-f]+$/.test(cleanHex) || cleanHex.length % 2 !== 0) {
    addLogToConsole(cellConsoleBody, `[Fallback Error] Invalid HEX command: ${cmdHex}`, 'error', chkCellTimeTag.checked);
    return;
  }

  // Parse command bytes
  const bytes = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
  }
  cellModbusSentCommandBytes = bytes;

  // Send to COM3
  console.log(`[Fallback Monitor] Sending command to Modbus Port: ${cleanHex}`);
  cellModbusSocket.send(JSON.stringify({
    action: 'write',
    data: cleanHex,
    hex: true
  }));
}

function resetCellModbusFallbackTimer() {
  if (cellModbusFallbackTimerId) {
    clearTimeout(cellModbusFallbackTimerId);
    cellModbusFallbackTimerId = null;
  }
}

function startFallbackTimerIfActive() {
  if (isCellModbusFallbackActive() && lastCellModbusTrafficTime > 0) {
    const timeoutSec = parseFloat(document.getElementById('cell-modbus-timeout').value) || 5;
    const elapsedMs = Date.now() - lastCellModbusTrafficTime;
    const timeoutMs = timeoutSec * 1000;
    
    if (elapsedMs >= timeoutMs) {
      console.log(`[Fallback Monitor] Modbus traffic ended ${Math.round(elapsedMs/1000)}s ago. Triggering fallback action immediately.`);
      if (cellModbusFallbackTimerId) clearTimeout(cellModbusFallbackTimerId);
      triggerModbusFallbackAction();
    } else {
      const remainingMs = timeoutMs - elapsedMs;
      console.log(`[Fallback Monitor] Modbus traffic ended. Triggering fallback action in ${Math.round(remainingMs/1000)}s.`);
      if (cellModbusFallbackTimerId) clearTimeout(cellModbusFallbackTimerId);
      cellModbusFallbackTimerId = setTimeout(() => {
        triggerModbusFallbackAction();
      }, remainingMs);
    }
  }
}

function handleModbusFrameDetected(type, frame) {
  const hexSpaced = bytesToHexSpaced(frame);
  console.log(`[Fallback Monitor] Detected ${type} frame: ${hexSpaced}`);

  if (type === 'response' || type === 'error') {
    lastCellModbusTrafficTime = Date.now();
    
    // Clear any existing fallback timer
    resetCellModbusFallbackTimer();

    // Start fallback timer only if both sockets are open (active)
    if (isCellModbusFallbackActive()) {
      const timeoutSec = parseFloat(document.getElementById('cell-modbus-timeout').value) || 5;
      console.log(`[Fallback Monitor] Starting timeout of ${timeoutSec} seconds...`);
      cellModbusFallbackTimerId = setTimeout(() => {
        triggerModbusFallbackAction();
      }, timeoutSec * 1000);
    }
  }
}

function detectFallbackTraffic(newBytes) {

  cellFallbackRxBuffer.push(...newBytes);
  if (cellFallbackRxBuffer.length > 512) {
    cellFallbackRxBuffer = cellFallbackRxBuffer.slice(-512);
  }

  let buf = cellFallbackRxBuffer;
  let offset = 0;

  while (offset < buf.length) {
    const parsed = tryParseModbusAt(buf, offset, 'auto');
    if (parsed) {
      handleModbusFrameDetected(parsed.type, parsed.frame);
      offset += parsed.len;
    } else {
      const { len } = modbusFrameLength(buf, offset, 'auto') || {};
      if (len === -1 || (len > 0 && offset + len > buf.length)) {
        break; // Wait for more data
      }
      offset++;
    }
  }

  if (offset > 0) {
    cellFallbackRxBuffer = buf.slice(offset);
  }
}


function toggleCellSettingsDisable(disabled) {
  if (cellPortSelect) cellPortSelect.disabled = disabled;
  if (cellBaudSelect) cellBaudSelect.disabled = disabled;
  if (cellDataBitsSelect) cellDataBitsSelect.disabled = disabled;
  if (cellStopBitsSelect) cellStopBitsSelect.disabled = disabled;
  if (cellParitySelect) cellParitySelect.disabled = disabled;
}

function closeCellSocketUI() {
  const port = cellPortSelect ? cellPortSelect.value : '';
  btnCellConnect.disabled = false;
  btnCellConnect.textContent = 'Connect Port';
  btnCellConnect.style.background = '';
  toggleCellControlButtons(false);
  toggleCellSettingsDisable(false);
  cellSocket = null;
  lastCellModbusTrafficTime = 0;
  
  if (cellModbusFallbackTimerId) {
    clearTimeout(cellModbusFallbackTimerId);
    cellModbusFallbackTimerId = null;
  }
  stopCellAutoCsqPolling(); // Clean up Auto CSQ Polling
  
  // Reset CSQ display elements to N/A
  const displayEl = document.getElementById('cell-auto-csq-display');
  if (displayEl) displayEl.textContent = 'N/A';
  const netCsqEl = document.getElementById('net-info-csq');
  if (netCsqEl) netCsqEl.textContent = 'N/A';
  
  if (btnCellRefreshCsq) {
    btnCellRefreshCsq.textContent = 'Query CSQ Now';
  }
  
  if (btnCellReload) {
    btnCellReload.textContent = 'Reload';
  }
  if (btnCellReboot) {
    btnCellReboot.textContent = 'Reboot';
  }
  
  if (port && typeof markPortOccupationLocally === 'function') {
    markPortOccupationLocally(port, false);
  } else {
    checkCellPortOccupation();
  }
}

function toggleCellControlButtons(enabled) {
  const csqEn = document.getElementById('cell-auto-csq-en');
  const csqInt = document.getElementById('cell-auto-csq-interval');
  [btnCellApplyMode, btnCellReloadUart, btnCellApplyUart, btnCellReloadSubs, btnCellApplySubs, btnCellReloadPubs, btnCellApplyPubs, btnCellApplyWill, btnCellReloadMqttcon, btnCellApplyMqttcon, btnCellPubModbus, btnCellReloadPoll, btnCellApplyPoll, btnCellCheckNet, btnCellConsoleSend, csqEn, csqInt, btnCellRefreshCsq, btnCellReload, btnCellReboot].forEach(btn => {
    if (btn) btn.disabled = !enabled;
  });
}

function loadHwStateIntoUI(state) {
  if (!state) return;
  
  if (state.work_mode) {
    const radio = document.querySelector(`input[name="cell-work-mode"][value="${state.work_mode}"]`);
    if (radio) radio.checked = true;
  }
  
  if (state.mqtt_ip) cellBrokerIp.value = state.mqtt_ip;
  if (state.mqtt_port) cellBrokerPort.value = state.mqtt_port;
  if (state.mqtt_cid) cellBrokerCid.value = state.mqtt_cid;
  if (state.mqtt_user) cellBrokerUser.value = state.mqtt_user;
  if (state.mqtt_pwd) cellBrokerPwd.value = state.mqtt_pwd;
  
  if (state.uart) {
    cellDtuBaud.value = state.uart.baud;
    cellDtuData.value = state.uart.data;
    cellDtuStop.value = state.uart.stop;
    cellDtuParity.value = state.uart.parity;
  }
  
  if (state.subs) {
    state.subs.forEach((sub, i) => {
      const en = document.getElementById(`cell-sub-en-${i}`);
      const t = document.getElementById(`cell-sub-t-${i}`);
      const q = document.getElementById(`cell-sub-q-${i}`);
      if (en) en.checked = sub.en;
      if (t) t.value = sub.topic;
      if (q) q.value = sub.qos;
    });
  }
  
  if (state.pubs) {
    state.pubs.forEach((pub, i) => {
      const en = document.getElementById(`cell-pub-en-${i}`);
      const t = document.getElementById(`cell-pub-t-${i}`);
      const q = document.getElementById(`cell-pub-q-${i}`);
      const r = document.getElementById(`cell-pub-r-${i}`);
      if (en) en.checked = pub.en;
      if (t) t.value = pub.topic;
      if (q) q.value = pub.qos;
      if (r) r.checked = pub.retain;
    });
  }
  
  if (state.will) {
    cellWillEn.checked = state.will.en;
    cellWillTopic.value = state.will.topic;
    cellWillMsg.value = state.will.msg;
    cellWillQos.value = state.will.qos;
    cellWillRetain.checked = state.will.retain;
  }
  
  if (state.clean_session !== undefined) cellCleanSession.checked = state.clean_session;
  if (state.keep_alive) cellKeepAlive.value = state.keep_alive;
  
  if (state.task_mode) {
    const radio = document.querySelector(`input[name="cell-task-mode"][value="${state.task_mode}"]`);
    if (radio) radio.checked = true;
  }
  
  if (state.task_cycle) cellTaskCycle.value = state.task_cycle;
  if (state.task_interval) cellTaskInterval.value = state.task_interval;
  if (state.enable_identifier !== undefined) cellTaskDistEn.checked = state.enable_identifier;
  if (state.identifier_format) cellTaskDistFmt.value = state.identifier_format;
  
  if (state.polling_list) {
    rebuildPollingListUI(state.polling_list);
  }
  
  if (state.network_info) {
    loadNetworkInfoIntoUI(state.network_info);
  }
  
  saveCellSettings();
  addLogToConsole(cellConsoleBody, '[System] Hardware configurations successfully synced into UI.', 'system', chkCellTimeTag.checked);
}

function loadNetworkInfoIntoUI(info) {
  if (!info) return;
  document.getElementById('net-info-module').textContent = info.MODULE || 'N/A';
  document.getElementById('net-info-sysinfo').textContent = info.SYSINFO || 'N/A';
  
  const csqVal = info.CSQ || 'N/A';
  document.getElementById('net-info-csq').textContent = csqVal;
  const displayEl = document.getElementById('cell-auto-csq-display');
  if (displayEl) {
    displayEl.textContent = csqVal;
  }
  
  document.getElementById('net-info-clk').textContent = info.CLK || 'N/A';
  document.getElementById('net-info-iccid').textContent = info.ICCID || 'N/A';
  document.getElementById('net-info-sn').textContent = info.SN || 'N/A';
  document.getElementById('net-info-imei').textContent = info.IMEI || 'N/A';
  document.getElementById('net-info-imsi').textContent = info.IMSI || 'N/A';
}

function rebuildPollingListUI(list) {
  if (!pollingCommandsTable) return;
  pollingCommandsTable.innerHTML = '';
  
  list.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.Index}</td>
      <td><input type="text" class="form-input poll-cmd-inp" value="${item.Command}" style="font-family: var(--font-mono); font-size:11px;"></td>
      <td style="text-align: center;"><button class="btn-remove-row">🗑️</button></td>
    `;
    pollingCommandsTable.appendChild(tr);
  });
  
  pollingCommandsTable.querySelectorAll('.btn-remove-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('tr').remove();
      renumberPollingRows();
    });
  });
}

function renumberPollingRows() {
  if (!pollingCommandsTable) return;
  const rows = pollingCommandsTable.querySelectorAll('tr');
  rows.forEach((row, i) => {
    row.querySelector('td').textContent = i + 1;
  });
}

function getPollingListFromUI() {
  const list = [];
  if (!pollingCommandsTable) return list;
  const rows = pollingCommandsTable.querySelectorAll('tr');
  rows.forEach((row, i) => {
    const cmd = row.querySelector('.poll-cmd-inp').value.trim();
    if (cmd) {
      // Read the actual row number displayed in the first <td> (set by renumberPollingRows / rebuildPollingListUI).
      // Using i+1 (forEach counter) would give wrong Index when the polling list was loaded from hardware
      // and earlier slots were empty — e.g. commands stored in DTU slots 12-20 would show as Index 1-9.
      const indexCell = row.querySelector('td');
      const displayedIndex = indexCell ? parseInt(indexCell.textContent.trim(), 10) : NaN;
      list.push({ Index: isNaN(displayedIndex) ? (i + 1) : displayedIndex, Command: cmd });
    }
  });
  return list;
}

if (btnCellPollAdd) {
  btnCellPollAdd.addEventListener('click', () => {
    if (!pollingCommandsTable) return;
    const count = pollingCommandsTable.querySelectorAll('tr').length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${count + 1}</td>
      <td><input type="text" class="form-input poll-cmd-inp" placeholder="e.g. 2F 03 00 32 00 64 AD FA" style="font-family: var(--font-mono); font-size:11px;"></td>
      <td style="text-align: center;"><button class="btn-remove-row">🗑️</button></td>
    `;
    pollingCommandsTable.appendChild(tr);
    
    tr.querySelector('.btn-remove-row').addEventListener('click', () => {
      tr.remove();
      renumberPollingRows();
    });
  });
}

// Generated Modbus hex calculator
function updateGeneratedModbusHex() {
  if (!cellModbusIdDec || !cellModbusFunc || !cellModbusAddrDec || !cellModbusQty || !modbusGenHexDisplay) return;
  const devIdStr = cellModbusIdDec.value.trim();
  const funcCodeStr = cellModbusFunc.value;
  const startAddrStr = cellModbusAddrDec.value.trim();
  const qtyStr = cellModbusQty.value.trim();
  
  if (!devIdStr || !startAddrStr || !qtyStr) {
    modbusGenHexDisplay.textContent = '------';
    return;
  }
  
  try {
    const devId = parseInt(devIdStr);
    const funcCode = parseInt(funcCodeStr, 16);
    const startAddr = parseInt(startAddrStr);
    const qty = parseInt(qtyStr);
    
    if (isNaN(devId) || isNaN(funcCode) || isNaN(startAddr) || isNaN(qty)) {
      modbusGenHexDisplay.textContent = 'Invalid values';
      return;
    }
    
    const buffer = new Uint8Array(6);
    buffer[0] = devId & 0xFF;
    buffer[1] = funcCode & 0xFF;
    buffer[2] = (startAddr >>> 8) & 0xFF;
    buffer[3] = startAddr & 0xFF;
    buffer[4] = (qty >>> 8) & 0xFF;
    buffer[5] = qty & 0xFF;
    
    const crc = calculateCrc16(buffer);
    
    const fullFrame = new Uint8Array(8);
    fullFrame.set(buffer);
    fullFrame[6] = crc & 0xFF;
    fullFrame[7] = (crc >>> 8) & 0xFF;
    
    let hexStr = '';
    fullFrame.forEach(b => {
      let s = b.toString(16).toUpperCase();
      if (s.length < 2) s = '0' + s;
      hexStr += s + ' ';
    });
    
    modbusGenHexDisplay.textContent = hexStr.trim();
  } catch (err) {
    modbusGenHexDisplay.textContent = 'Error';
  }
}

// DEC/HEX syncer inputs
if (cellModbusIdHex) {
  cellModbusIdHex.addEventListener('input', () => {
    let val = cellModbusIdHex.value.trim();
    if (val.toLowerCase().startsWith('0x')) val = val.substring(2);
    const dec = parseInt(val, 16);
    if (!isNaN(dec)) {
      cellModbusIdDec.value = dec;
      updateGeneratedModbusHex();
    }
  });
}
if (cellModbusIdDec) {
  cellModbusIdDec.addEventListener('input', () => {
    const dec = parseInt(cellModbusIdDec.value.trim());
    if (!isNaN(dec)) {
      let hex = dec.toString(16).toUpperCase();
      if (hex.length < 2) hex = '0' + hex;
      cellModbusIdHex.value = '0x' + hex;
      updateGeneratedModbusHex();
    }
  });
}
if (cellModbusAddrHex) {
  cellModbusAddrHex.addEventListener('input', () => {
    let val = cellModbusAddrHex.value.trim();
    if (val.toLowerCase().startsWith('0x')) val = val.substring(2);
    const dec = parseInt(val, 16);
    if (!isNaN(dec)) {
      cellModbusAddrDec.value = dec;
      updateGeneratedModbusHex();
    }
  });
}
if (cellModbusAddrDec) {
  cellModbusAddrDec.addEventListener('input', () => {
    const dec = parseInt(cellModbusAddrDec.value.trim());
    if (!isNaN(dec)) {
      let hex = dec.toString(16).toUpperCase();
      while (hex.length < 4) hex = '0' + hex;
      cellModbusAddrHex.value = '0x' + hex;
      updateGeneratedModbusHex();
    }
  });
}
if (cellModbusFunc) cellModbusFunc.addEventListener('change', updateGeneratedModbusHex);
if (cellModbusQty) cellModbusQty.addEventListener('input', updateGeneratedModbusHex);

if (btnCellConnect) btnCellConnect.addEventListener('click', connectCellularDTU);

const btnCellModbusConnect = document.getElementById('btn-cell-modbus-connect');
if (btnCellModbusConnect) btnCellModbusConnect.addEventListener('click', connectCellModbusPort);

const btnCellModbusSend = document.getElementById('btn-cell-modbus-send');
if (btnCellModbusSend) btnCellModbusSend.addEventListener('click', sendCellModbusManualRequest);

const cellModbusPortSelect = document.getElementById('cell-modbus-port-select');
const cellModbusBaudSelect = document.getElementById('cell-modbus-baud-select');
const cellModbusDataBitsSelect = document.getElementById('cell-modbus-data-bits-select');
const cellModbusStopBitsSelect = document.getElementById('cell-modbus-stop-bits-select');
const cellModbusParitySelect = document.getElementById('cell-modbus-parity-select');
const cellModbusTimeout = document.getElementById('cell-modbus-timeout');
const cellModbusFallbackCmd = document.getElementById('cell-modbus-fallback-cmd');

[cellModbusPortSelect, cellModbusBaudSelect, cellModbusDataBitsSelect, cellModbusStopBitsSelect, cellModbusParitySelect, cellModbusTimeout, cellModbusFallbackCmd].forEach(el => {
  if (el) el.addEventListener('change', () => {
    saveCellModbusSettings();
    if (el === cellModbusPortSelect) {
      checkCellPortOccupation();
    }
  });
});


if (btnCellApplyMode) {
  btnCellApplyMode.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      const mode = document.querySelector('input[name="cell-work-mode"]:checked').value;
      const ip = cellBrokerIp.value;
      const port = cellBrokerPort.value;
      const cid = cellBrokerCid.value;
      const user = cellBrokerUser.value;
      const pwd = cellBrokerPwd.value;
      cellSocket.send(JSON.stringify({ action: 'apply_work_mode', mode, ip, port, cid, user, pwd }));
    }
  });
}

if (btnCellReloadUart) {
  btnCellReloadUart.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      cellSocket.send(JSON.stringify({ action: 'provision' }));
    }
  });
}

if (btnCellReloadSubs) {
  btnCellReloadSubs.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      cellSocket.send(JSON.stringify({ action: 'provision' }));
    }
  });
}

if (btnCellReloadPubs) {
  btnCellReloadPubs.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      cellSocket.send(JSON.stringify({ action: 'provision' }));
    }
  });
}

if (btnCellReloadMqttcon) {
  btnCellReloadMqttcon.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      cellSocket.send(JSON.stringify({ action: 'provision' }));
    }
  });
}

if (btnCellReloadPoll) {
  btnCellReloadPoll.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      cellSocket.send(JSON.stringify({ action: 'provision' }));
    }
  });
}

if (btnCellApplyUart) {
  btnCellApplyUart.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      const baud = parseInt(cellDtuBaud.value);
      const stop = cellDtuStop.value;
      const data = parseInt(cellDtuData.value);
      const parity = cellDtuParity.value === 'None' ? 'NONE' : cellDtuParity.value.toUpperCase();
      cellSocket.send(JSON.stringify({ action: 'apply_uart', baud, stop, data, parity }));
    }
  });
}

if (btnCellApplySubs) {
  btnCellApplySubs.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      const subs = [];
      for (let i = 0; i < 4; i++) {
        subs.push({
          en: document.getElementById(`cell-sub-en-${i}`).checked,
          topic: document.getElementById(`cell-sub-t-${i}`).value.trim(),
          qos: parseInt(document.getElementById(`cell-sub-q-${i}`).value)
        });
      }
      cellSocket.send(JSON.stringify({ action: 'apply_subs', subs }));
    }
  });
}

if (btnCellApplyPubs) {
  btnCellApplyPubs.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      const pubs = [];
      for (let i = 0; i < 4; i++) {
        pubs.push({
          en: document.getElementById(`cell-pub-en-${i}`).checked,
          topic: document.getElementById(`cell-pub-t-${i}`).value.trim(),
          qos: parseInt(document.getElementById(`cell-pub-q-${i}`).value),
          retain: document.getElementById(`cell-pub-r-${i}`).checked
        });
      }
      cellSocket.send(JSON.stringify({ action: 'apply_pubs', pubs }));
    }
  });
}

if (btnCellApplyWill) {
  btnCellApplyWill.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      const en = cellWillEn.checked;
      const topic = cellWillTopic.value.trim();
      const msg = cellWillMsg.value;
      const qos = parseInt(cellWillQos.value);
      const retain = cellWillRetain.checked;
      cellSocket.send(JSON.stringify({ action: 'apply_will', en, topic, msg, qos, retain }));
    }
  });
}

if (btnCellApplyMqttcon) {
  btnCellApplyMqttcon.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      const clean_session = cellCleanSession.checked;
      const keep_alive = parseInt(cellKeepAlive.value);
      cellSocket.send(JSON.stringify({ action: 'apply_mqttcon', clean_session, keep_alive }));
    }
  });
}

if (btnCellPubModbus) {
  btnCellPubModbus.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      const hexStr = modbusGenHexDisplay.textContent.trim();
      if (hexStr && hexStr !== '------' && hexStr !== 'Error') {
        cellSocket.send(JSON.stringify({ action: 'write', data: hexStr, hex: true }));
        if (isCellModbusFallbackActive()) {
          resetCellModbusFallbackTimer();
        }
        const timePrefix = chkCellTimeTag && chkCellTimeTag.checked ? getFormattedTime() + ' ' : '';
        const line = document.createElement('div');
        line.className = 'console-line send-msg';
        line.textContent = `${timePrefix}>> ${hexStr}`;
        cellConsoleBody.appendChild(line);
        const crcEnabled = chkCellModbusCrc ? chkCellModbusCrc.checked : false;
        if (crcEnabled) {
          cellRecordSentFrame(hexStr);
        }
        // Postpone Auto CSQ query whenever a Modbus command is sent (TX activity)
        const txBytes = hexStr.replace(/\s+/g, '').match(/.{1,2}/g)
          ? hexStr.replace(/\s+/g, '').match(/.{1,2}/g).map(h => parseInt(h, 16))
          : [];
        if (txBytes.length > 0 && hasModbusActivity(txBytes)) {
          postponeCellAutoCsqPolling();
        }
        cellConsoleHistory.push({ type: 'send', data: `>> ${hexStr}`, timestamp: getFormattedTime() });
        saveCellConsoleHistory();
        
        if (cellConsoleBody.children.length > 500) cellConsoleBody.removeChild(cellConsoleBody.firstChild);
        if (chkCellAutoscroll && chkCellAutoscroll.checked) cellConsoleBody.scrollTop = cellConsoleBody.scrollHeight;
      }
    }
  });
}

if (btnCellApplyPoll) {
  btnCellApplyPoll.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      const task_mode = document.querySelector('input[name="cell-task-mode"]:checked').value;
      const cycle = parseInt(cellTaskCycle.value);
      const interval = parseInt(cellTaskInterval.value);
      const enable_identifier = cellTaskDistEn.checked;
      const identifier_format = cellTaskDistFmt.value;
      const list = getPollingListFromUI();
      cellSocket.send(JSON.stringify({ action: 'apply_polling', task_mode, cycle, interval, enable_identifier, identifier_format, list }));
    }
  });
}

if (btnCellCheckNet) {
  btnCellCheckNet.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      cellSocket.send(JSON.stringify({ action: 'check_network' }));
    }
  });
}

if (btnCellConsoleSend) {
  btnCellConsoleSend.addEventListener('click', () => {
    let text = cellConsoleSendInput.value.trim();
    if (!text) return;
    
    // Append selected line ending
    const ending = cellLineEndingSelect ? cellLineEndingSelect.value : 'crlf';
    let displayText = text;
    if (ending === 'lf') {
      text += '\n';
      displayText += '\\n';
    } else if (ending === 'cr') {
      text += '\r';
      displayText += '\\r';
    } else if (ending === 'crlf') {
      text += '\r\n';
      displayText += '\\r\\n';
    }
    
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      cellSocket.send(JSON.stringify({ action: 'write', data: text, hex: false }));
      if (isCellModbusFallbackActive()) {
        resetCellModbusFallbackTimer();
      }
      const crcEnabled = chkCellModbusCrc ? chkCellModbusCrc.checked : false;
      const clean = text.replace(/\s+/g, '');
      const isHexPayload = /^[0-9A-Fa-f]+$/.test(clean) && clean.length % 2 === 0;
      if (crcEnabled) {
        // Record sent frame for modbus response correlation
        if (isHexPayload) {
          cellRecordSentFrame(text);
        } else {
          cellRecordSentFrame(stringToHex(text));
        }
      }
      // Postpone Auto CSQ query whenever a Modbus command is sent (TX activity)
      if (isHexPayload) {
        const txBytes = clean.match(/.{1,2}/g).map(h => parseInt(h, 16));
        if (hasModbusActivity(txBytes)) {
          postponeCellAutoCsqPolling();
        }
      }
      addLogToConsole(cellConsoleBody, `>> ${displayText}`, 'send', chkCellTimeTag.checked);
      cellConsoleSendInput.value = '';
    }
  });
}

if (cellConsoleSendInput) {
  cellConsoleSendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnCellConsoleSend.click();
    }
  });
}

if (btnClearCellConsole) {
  btnClearCellConsole.addEventListener('click', () => {
    cellConsoleBody.innerHTML = '';
    cellConsoleHistory = [];
    localStorage.removeItem('cell_console_history');
  });
}

const btnCopyCellConsole = document.getElementById('btn-copy-cell-console');
if (btnCopyCellConsole) {
  btnCopyCellConsole.addEventListener('click', async () => {
    const cellText = getConsoleText(cellConsoleBody);
    try {
      await navigator.clipboard.writeText(cellText);
      flashCopyIcon(btnCopyCellConsole);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  });
}

// Rebuild cell console lines when HEX mode or CRC check changes
function rebuildCellConsole() {
  cellConsoleBody.innerHTML = '';
  const hexMode = chkCellHexMode ? chkCellHexMode.checked : false;
  const crcEnabled = chkCellModbusCrc ? chkCellModbusCrc.checked : false;
  const showTime = chkCellTimeTag ? chkCellTimeTag.checked : true;

  cellConsoleHistory.forEach(item => {
    const timePrefix = showTime ? (item.timestamp || getFormattedTime()) + ' ' : '';
    const line = document.createElement('div');
    line.className = 'console-line';

    if (item.type === 'recv') {
      line.classList.add('recv-msg');
      if (item.data !== undefined) {
        let displayData = item.data;
        const isNotify = shouldForceAscii(item.data);
        if (hexMode && !isNotify) {
          displayData = stringToHex(item.data);
        } else if (typeof item.data === 'string') {
          const cleanHex = item.data.replace(/\s+/g, '');
          if (!isNotify && /^[0-9A-Fa-f]{6,}$/.test(cleanHex) && cleanHex.length % 2 === 0) {
            displayData = formatHexWithSpaces(cleanHex);
          }
        }
        line.textContent = `${timePrefix}<< ${displayData}`;
        line.dataset.rawData = item.data;
      } else {
        line.textContent = `${timePrefix}${item.text || ''}`;
      }
      cellConsoleBody.appendChild(line);
    } else if (item.type === 'send') {
      line.classList.add('send-msg');
      line.textContent = `${timePrefix}${item.data !== undefined ? item.data : (item.text || '')}`;
      cellConsoleBody.appendChild(line);
    } else if (item.type === 'system' || item.type === 'error') {
      line.classList.add(item.type === 'error' ? 'error-msg' : 'system-msg');
      line.textContent = `${timePrefix}${item.text}`;
      cellConsoleBody.appendChild(line);

      if (item.crcBadge && crcEnabled) {
        const badge = document.createElement('span');
        badge.className = `crc-badge ${item.crcBadge === 'OK' ? 'crc-ok' : 'crc-err'}`;
        badge.textContent = `CRC: ${item.crcBadge}`;
        line.appendChild(badge);
      }
    }
  });

  if (chkCellAutoscroll && chkCellAutoscroll.checked) {
    cellConsoleBody.scrollTop = cellConsoleBody.scrollHeight;
  }
}

if (chkCellHexMode) {
  chkCellHexMode.addEventListener('change', () => {
    saveCellSettings();
    rebuildCellConsole();
  });
}
if (chkCellModbusCrc) {
  chkCellModbusCrc.addEventListener('change', () => {
    saveCellSettings();
    rebuildCellConsole();
  });
}
if (chkCellTimeTag) {
  chkCellTimeTag.addEventListener('change', () => {
    saveCellSettings();
    rebuildCellConsole();
  });
}
if (chkCellAutoscroll) {
  chkCellAutoscroll.addEventListener('change', () => {
    saveCellSettings();
  });
}

[cellPortSelect, cellBaudSelect, cellDataBitsSelect, cellStopBitsSelect, cellParitySelect, cellBrokerIp, cellBrokerPort, cellBrokerCid, cellBrokerUser, cellBrokerPwd, cellDtuBaud, cellDtuData, cellDtuStop, cellDtuParity, cellWillEn, cellWillTopic, cellWillMsg, cellWillQos, cellWillRetain, cellCleanSession, cellKeepAlive, cellModbusIdHex, cellModbusIdDec, cellModbusFunc, cellModbusAddrHex, cellModbusAddrDec, cellModbusQty, cellTaskCycle, cellTaskInterval, cellTaskDistEn, cellTaskDistFmt, cellLineEndingSelect].forEach(el => {
  if (el) el.addEventListener('change', () => {
    saveCellSettings();
    if (el === cellPortSelect) {
      checkCellPortOccupation();
    }
  });
});

const cellAutoCsqEn = document.getElementById('cell-auto-csq-en');
const cellAutoCsqInterval = document.getElementById('cell-auto-csq-interval');

if (btnCellRefreshCsq) {
  btnCellRefreshCsq.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      if (!isCellAutoCsqQuerying) {
        isCellAutoCsqQuerying = true;
        btnCellRefreshCsq.disabled = true;
        btnCellRefreshCsq.textContent = 'Querying...';
        cellSocket.send(JSON.stringify({ action: 'query_csq' }));
      }
    }
  });
}

if (btnCellReload) {
  btnCellReload.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      btnCellReload.disabled = true;
      btnCellReload.textContent = 'Reloading...';
      cellSocket.send(JSON.stringify({ action: 'provision' }));
    }
  });
}

if (btnCellReboot) {
  btnCellReboot.addEventListener('click', () => {
    if (cellSocket && cellSocket.readyState === WebSocket.OPEN) {
      btnCellReboot.disabled = true;
      btnCellReboot.textContent = 'Rebooting...';
      cellSocket.send(JSON.stringify({ action: 'reboot' }));
    }
  });
}

if (cellAutoCsqEn) {
  cellAutoCsqEn.addEventListener('change', () => {
    saveCellSettings();
    if (cellAutoCsqEn.checked) {
      startCellAutoCsqPolling();
    } else {
      stopCellAutoCsqPolling();
    }
  });
}

if (cellAutoCsqInterval) {
  cellAutoCsqInterval.addEventListener('change', () => {
    saveCellSettings();
    if (cellAutoCsqEn && cellAutoCsqEn.checked) {
      startCellAutoCsqPolling();
    }
  });
}

// Bind slot list inputs
for (let i = 0; i < 4; i++) {
  const csen = document.getElementById(`cell-sub-en-${i}`);
  const cst = document.getElementById(`cell-sub-t-${i}`);
  const csq = document.getElementById(`cell-sub-q-${i}`);
  const cpen = document.getElementById(`cell-pub-en-${i}`);
  const cpt = document.getElementById(`cell-pub-t-${i}`);
  const cpq = document.getElementById(`cell-pub-q-${i}`);
  const cpret = document.getElementById(`cell-pub-r-${i}`);
  
  if (csen) csen.addEventListener('change', saveCellSettings);
  if (cst) cst.addEventListener('change', saveCellSettings);
  if (csq) csq.addEventListener('change', saveCellSettings);
  if (cpen) cpen.addEventListener('change', saveCellSettings);
  if (cpt) cpt.addEventListener('change', saveCellSettings);
  if (cpq) cpq.addEventListener('change', saveCellSettings);
  if (cpret) cpret.addEventListener('change', saveCellSettings);
}


// ==========================================
// PERFORMANCE TRACKER & CANVAS PLOTTER
// ==========================================
class PerformanceTracker {
  constructor() {
    this.cellularMsgs = []; // list of { hex, time }
    this.matchedPoints = []; // list of { timestamp, delay, legend }
    this.metrics = {
      success: 0,
      corrupted: 0,
      pending: 0,
      avgLatency: 0
    };
  }
  
  registerCellularMsg(pktBytes) {
    let hexStr = '';
    pktBytes.forEach(b => {
      let s = b.toString(16).toUpperCase();
      if (s.length < 2) s = '0' + s;
      hexStr += s;
    });
    
    this.cellularMsgs.push({
      hex: hexStr,
      time: Date.now()
    });
    
    if (this.cellularMsgs.length > 100) this.cellularMsgs.shift();
    
    this.metrics.pending++;
    this.updateMetricsUI();
    this.checkPendingTimeout();
  }
  
  registerInternetMsg(payloadStr) {
    // payloadStr is latin1-decoded from backend: each charCode == original byte value.
    // Convert to a compact uppercase hex string so we can match against cellular hex.
    const cleanPayloadHex = stringToHex(payloadStr).replace(/\s+/g, '').toUpperCase();
    const now = Date.now();
    
    for (let i = this.cellularMsgs.length - 1; i >= 0; i--) {
      const cellMsg = this.cellularMsgs[i];
      if (cleanPayloadHex.includes(cellMsg.hex)) {
        const delay = (now - cellMsg.time) / 1000;
        
        let legend = 'Success';
        if (cleanPayloadHex.startsWith(cellMsg.hex)) {
          legend = 'Corrupted';
          this.metrics.corrupted++;
        } else {
          this.metrics.success++;
        }
        
        if (this.metrics.pending > 0) this.metrics.pending--;
        
        const dateObj = new Date(cellMsg.time);
        const tsStr = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}:${String(dateObj.getSeconds()).padStart(2, '0')}`;
        
        this.matchedPoints.push({
          timestamp: tsStr,
          delay: Math.max(0.001, delay),
          legend: legend,
          cellTime: cellMsg.time
        });
        
        if (this.matchedPoints.length > 50) this.matchedPoints.shift();
        this.cellularMsgs.splice(i, 1);
        
        this.recalculateAvgLatency();
        this.updateMetricsUI();
        
        if (panePerf && panePerf.classList.contains('active')) {
          drawPerformanceChart();
        }
        break;
      }
    }
  }
  
  checkPendingTimeout() {
    const now = Date.now();
    let updated = false;
    for (let i = this.cellularMsgs.length - 1; i >= 0; i--) {
      const cellMsg = this.cellularMsgs[i];
      if (now - cellMsg.time > 5000) {
        this.cellularMsgs.splice(i, 1);
        if (this.metrics.pending > 0) this.metrics.pending--;
        
        const dateObj = new Date(cellMsg.time);
        const tsStr = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}:${String(dateObj.getSeconds()).padStart(2, '0')}`;
        
        this.matchedPoints.push({
          timestamp: tsStr,
          delay: 5.0,
          legend: 'Fail',
          cellTime: cellMsg.time
        });
        
        if (this.matchedPoints.length > 50) this.matchedPoints.shift();
        updated = true;
      }
    }
    if (updated) {
      this.updateMetricsUI();
      if (panePerf && panePerf.classList.contains('active')) {
        drawPerformanceChart();
      }
    }
  }
  
  recalculateAvgLatency() {
    const successes = this.matchedPoints.filter(p => p.legend === 'Success' || p.legend === 'Corrupted');
    if (successes.length === 0) {
      this.metrics.avgLatency = 0;
      return;
    }
    const sum = successes.reduce((acc, p) => acc + p.delay, 0);
    this.metrics.avgLatency = (sum / successes.length) * 1000;
  }
  
  updateMetricsUI() {
    const successVal = document.getElementById('perf-val-success');
    const corruptedVal = document.getElementById('perf-val-corrupted');
    const pendingVal = document.getElementById('perf-val-pending');
    const latencyVal = document.getElementById('perf-val-latency');
    
    if (successVal) successVal.innerHTML = `${this.metrics.success}<span class="perf-unit">pkts</span>`;
    if (corruptedVal) corruptedVal.innerHTML = `${this.metrics.corrupted}<span class="perf-unit">pkts</span>`;
    if (pendingVal) pendingVal.innerHTML = `${this.metrics.pending}<span class="perf-unit">pkts</span>`;
    if (latencyVal) latencyVal.innerHTML = `${this.metrics.avgLatency.toFixed(1)}<span class="perf-unit">ms</span>`;
  }
}

const performanceTracker = new PerformanceTracker();
setInterval(() => {
  performanceTracker.checkPendingTimeout();
}, 1000);

// Canvas plotting function
function drawPerformanceChart() {
  const canvas = document.getElementById('perf-latency-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  const width = rect.width;
  const height = rect.height;
  
  ctx.clearRect(0, 0, width, height);
  
  ctx.strokeStyle = '#222730';
  ctx.lineWidth = 1;
  
  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 40;
  const paddingBottom = 40;
  
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  
  const ticks = [1, 10, 50, 200, 500, 1000];
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#657388';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  function getValY(msVal) {
    const minLog = Math.log10(1);
    const maxLog = Math.log10(1500);
    const logVal = Math.log10(Math.max(1, msVal));
    const percent = (logVal - minLog) / (maxLog - minLog);
    return paddingTop + chartHeight * (1 - percent);
  }
  
  ticks.forEach(t => {
    const y = getValY(t);
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(width - paddingRight, y);
    ctx.stroke();
    
    ctx.fillText(`${t}ms`, paddingLeft - 8, y);
  });
  
  ctx.strokeStyle = '#38444d';
  ctx.beginPath();
  ctx.moveTo(paddingLeft, height - paddingBottom);
  ctx.lineTo(width - paddingRight, height - paddingBottom);
  ctx.stroke();
  
  const pts = performanceTracker.matchedPoints;
  if (pts.length === 0) {
    ctx.fillStyle = '#657388';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No matched packets to analyze performance latency.', width / 2, height / 2);
    return;
  }
  
  const barSpacing = chartWidth / 50;
  const barWidth = Math.max(2, barSpacing * 0.7);
  
  pts.forEach((pt, i) => {
    const x = paddingLeft + i * barSpacing + (barSpacing - barWidth) / 2;
    const ms = pt.delay * 1000;
    const y = getValY(ms);
    const bottomY = height - paddingBottom;
    
    if (pt.legend === 'Success') ctx.fillStyle = '#2ecc71';
    else if (pt.legend === 'Corrupted') ctx.fillStyle = '#f39c12';
    else ctx.fillStyle = '#e74c3c';
    
    ctx.fillRect(x, y, barWidth, bottomY - y);
    
    if (i % 5 === 0) {
      ctx.fillStyle = '#657388';
      ctx.textAlign = 'center';
      ctx.fillText(i + 1, x + barWidth / 2, bottomY + 12);
    }
  });
  
  ctx.textAlign = 'left';
  const legendItems = [
    { label: 'Success', color: '#2ecc71' },
    { label: 'Corrupted Header', color: '#f39c12' },
    { label: 'Fail / Pending Timeout', color: '#e74c3c' }
  ];
  
  let currentX = paddingLeft;
  legendItems.forEach(item => {
    ctx.fillStyle = item.color;
    ctx.fillRect(currentX, 15, 12, 8);
    
    ctx.fillStyle = '#657388';
    ctx.fillText(item.label, currentX + 16, 20);
    currentX += 130;
  });
}

function calculateCrc16(buffer) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >>> 1) ^ 0xA001;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return crc;
}

function findModbusPackets(rawBytes) {
  const packets = [];
  if (!rawBytes || rawBytes.length < 4) return packets;
  
  let offset = 0;
  while (offset + 4 <= rawBytes.length) {
    const fc = rawBytes[offset + 1];
    if (fc >= 1 && fc <= 4) {
      if (offset + 2 < rawBytes.length) {
        const byteCount = rawBytes[offset + 2];
        const length = 3 + byteCount + 2;
        if (offset + length <= rawBytes.length) {
          const pkt = rawBytes.slice(offset, offset + length);
          const calcCrc = calculateCrc16(pkt.slice(0, -2));
          const recLow = pkt[pkt.length - 2];
          const recHigh = pkt[pkt.length - 1];
          const recCrc = recLow | (recHigh << 8);
          
          if (calcCrc === recCrc) {
            packets.push(pkt);
            offset += length;
            continue;
          }
        }
      }
    }
    offset++;
  }
  return packets;
}

// Initialize settings on startup
loadInetSettings();
loadCellSettings();
loadCellModbusSettings();
loadInetConsoleHistory();
loadCellConsoleHistory();
updateGeneratedModbusHex();
updateSidebarCsqCardVisibility();


window.addEventListener('resize', () => {
  if (panePerf && panePerf.classList.contains('active')) {
    drawPerformanceChart();
  }
});

