import { app, BrowserWindow } from 'electron';
import path from 'path';
import { setupIpcBridge, startRealServices } from './ipc/index.js';
import { detectProjectRoot, getCurrentBranch } from '../src/core/project.js';
import { ProfileStore } from '../src/core/profile.js';
import { connectElectronToDaemon } from './daemon-connect.js';
import type { DaemonSession } from '../src/app/client/session.js';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

// Phase 13.4 — the live daemon-client session for the current
// project. Populated once the renderer finishes loading so the
// daemon's Metro / DevTools / Builder / Watcher adapters are on
// the serviceBus before any ipcMain handler consults them.
// `null` until the renderer signals `did-finish-load`; the
// in-process `startRealServices` path still covers the module
// system + instance orchestration during the 13.4.1 transition.
let daemonSession: DaemonSession | null = null;

/** Wait for Vite dev server to be ready, trying ports 5173-5180, with retries */
async function waitForVite(maxRetries = 30): Promise<number> {
  const http = require('http') as typeof import('http');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (let port = 5173; port <= 5180; port++) {
      try {
        const ok = await new Promise<boolean>((resolve) => {
          const req = http.get(`http://localhost:${port}`, (res: any) => {
            res.destroy();
            resolve(res.statusCode === 200);
          });
          req.on('error', () => resolve(false));
          req.setTimeout(300, () => { req.destroy(); resolve(false); });
        });
        if (ok) return port;
      } catch {}
    }
    // Wait 500ms before retrying
    await new Promise(r => setTimeout(r, 500));
    if (attempt % 5 === 4) {
      console.log(`[electron] Waiting for Vite dev server... (attempt ${attempt + 1})`);
    }
  }

  console.log('[electron] Vite not found, falling back to port 5173');
  return 5173;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1b26',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,  // Enable <webview> for DevTools
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
    },
  });

  if (isDev) {
    // Wait for Vite to be ready before loading
    const vitePort = await waitForVite();
    console.log(`[electron] Loading Vite dev server on port ${vitePort}`);
    mainWindow.loadURL(`http://localhost:${vitePort}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Detect the RN project root BEFORE setting up IPC so wizard handlers work
  const cwd = process.cwd();
  console.log(`[electron] CWD: ${cwd}`);
  const projectRoot = await detectProjectRoot(cwd)
    ?? await detectProjectRoot('/Users/martincouso/Documents/Projects/movie-nights-club')
    ?? cwd;
  console.log(`[electron] Project root: ${projectRoot}`);

  // Pass projectRoot to IPC bridge so wizard handlers have it immediately
  setupIpcBridge(mainWindow, projectRoot);

  // Start real services after renderer has loaded
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[electron] Renderer loaded, starting services...');
    setTimeout(() => {
      startRealServices(projectRoot).then(() => {
        console.log('[electron] Services started successfully');
      }).catch((err) => {
        console.error('[electron] Failed to start services:', err);
        // Send the error to the renderer so user can see it
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('service:log', `✖ Service error: ${err.message ?? err}`);
        }
      });

      // Phase 13.4 — open a daemon-client session alongside the
      // in-process services. The daemon already owns a full
      // `bootSessionServices` lifecycle (preflight / clean /
      // watchman / metro / builder / watcher / module host), so
      // this connection doesn't replace `startRealServices` yet;
      // it stands up the adapter refs on the serviceBus so the
      // next round of handler flips (13.4.1) can consume them.
      // Failures are non-fatal — in-process services still cover
      // the UI in 13.4.
      void connectDaemonClientBestEffort(projectRoot);
    }, 1000);
  });
}

async function connectDaemonClientBestEffort(projectRoot: string): Promise<void> {
  try {
    const profileStore = new ProfileStore(
      path.join(projectRoot, '.rn-dev', 'profiles'),
    );
    const branch = (await getCurrentBranch(projectRoot)) ?? 'main';
    const profile = profileStore.findDefault(null, branch);
    if (!profile) {
      console.log('[electron] No default profile — skipping daemon connect');
      return;
    }
    daemonSession = await connectElectronToDaemon({
      projectRoot,
      profile,
    });
    console.log(
      `[electron] Daemon client connected — worktreeKey=${daemonSession.worktreeKey}`,
    );

    // When the daemon drops unexpectedly, surface it in the service
    // log; a future 13.4.1 reconnect handler can react here.
    daemonSession.metro.on('disconnected', (err) => {
      const message = err instanceof Error ? err.message : 'unknown';
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          'service:log',
          `⚠ Daemon disconnected: ${message}`,
        );
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[electron] Daemon connect failed (non-fatal):', message);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Phase 13.4 — disconnect (don't stop) so any other client
  // attached to the same daemon (CLI, MCP) keeps working after the
  // Electron window goes away. `stop()` here would be wrong: it
  // tells the daemon to tear the session down for everyone.
  if (daemonSession) {
    try {
      daemonSession.disconnect();
    } catch {
      /* best-effort on shutdown */
    }
    daemonSession = null;
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

export { mainWindow };
