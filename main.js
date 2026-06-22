const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let backendProcess;

function startBackend() {
  const isPackaged = app.isPackaged;
  let backendPath;
  let args = [];
  let cwd = __dirname;

  if (isPackaged) {
    // Packaged backend location (extraResources)
    backendPath = path.join(process.resourcesPath, 'backend.exe');
  } else {
    // Development backend location
    backendPath = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
    args = ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'];
  }

  console.log(`Starting backend from: ${backendPath} with args: ${args}`);
  
  // Use shell: true to resolve commands correctly on Windows
  backendProcess = spawn(backendPath, args, {
    cwd: cwd,
    stdio: 'ignore',
    shell: true
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend process:', err);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`Backend process exited with code ${code} and signal ${signal}`);
  });
}

function checkBackendReady(callback) {
  const req = http.get('http://127.0.0.1:8000/', (res) => {
    // Status 200 or 404 is ok since it means the server responded
    if (res.statusCode === 200 || res.statusCode === 404) {
      callback(true);
    } else {
      callback(false);
    }
  });

  req.on('error', () => {
    callback(false);
  });

  req.end();
}

function waitForBackend(callback, retries = 50, interval = 200) {
  checkBackendReady((ready) => {
    if (ready) {
      callback();
    } else if (retries > 0) {
      setTimeout(() => waitForBackend(callback, retries - 1, interval), interval);
    } else {
      console.error('Backend did not become ready in time.');
      callback();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'SENTINEL HMI - System Automatyzacji Parkingu',
    icon: path.join(__dirname, 'backend', 'app', 'static', 'favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.setMenuBarVisibility(false);

  waitForBackend(() => {
    mainWindow.loadURL('http://127.0.0.1:8000/');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    try {
      if (process.platform === 'win32') {
        // Kill the spawned process tree on Windows
        spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
      } else {
        backendProcess.kill();
      }
    } catch (e) {
      console.error('Error killing backend process:', e);
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
