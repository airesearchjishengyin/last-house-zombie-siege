const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

let backend;

function findPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function startBackend(port) {
  const root = path.resolve(__dirname, '..');
  const executableName = process.platform === 'win32' ? 'last-house-server.exe' : 'last-house-server';
  const bundledBackend = path.join(process.resourcesPath, 'backend', executableName);
  const env = { ...process.env, PORT: String(port) };
  env.DECISION_API ||= 'http://127.0.0.1:8790';

  if (app.isPackaged || fs.existsSync(bundledBackend)) {
    backend = spawn(bundledBackend, [], { env, windowsHide: true, stdio: 'ignore' });
  } else {
    backend = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      [path.join(root, 'server.py')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  }
  backend.once('error', (error) => console.error('Could not start local game service:', error));
}

async function waitForBackend(port) {
  const url = `http://127.0.0.1:${port}/`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (backend?.exitCode !== null && backend?.exitCode !== undefined) {
      throw new Error(`Local game service exited with code ${backend.exitCode}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (response.ok) return url;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Local game service did not become ready');
}

async function openGame() {
  const port = await findPort();
  startBackend(port);
  const url = await waitForBackend(port);
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 700,
    title: '最后防线：尸潮围城',
    backgroundColor: '#111816',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  await window.loadURL(url);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.whenReady().then(openGame).catch((error) => {
    dialog.showErrorBox('Last House could not start', error.message);
    app.quit();
  });
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
  app.on('before-quit', () => backend?.kill());
  app.on('window-all-closed', () => app.quit());
}
