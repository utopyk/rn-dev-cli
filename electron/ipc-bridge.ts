import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { serviceBus } from '../src/app/service-bus.js';
import { MetroManager } from '../src/core/metro.js';
import { ArtifactStore } from '../src/core/artifact.js';
import { ProfileStore } from '../src/core/profile.js';
import { Builder } from '../src/core/builder.js';
import { FileWatcher } from '../src/core/watcher.js';
import { detectProjectRoot, getCurrentBranch, getWorktrees } from '../src/core/project.js';
import { listDevices, bootDevice } from '../src/core/device.js';
import { createDefaultPreflightEngine } from '../src/core/preflight.js';
import { execShellAsync } from '../src/core/exec-async.js';
import type { Profile } from '../src/core/types.js';

let mainWindow: BrowserWindow | null = null;
let metro: MetroManager | null = null;
let builder: Builder | null = null;
let watcher: FileWatcher | null = null;
let currentProfile: Profile | null = null;
let worktreeKey: string | null = null;
let projectRoot: string | null = null;
let artifactStore: ArtifactStore | null = null;

function send(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

export function setupIpcBridge(window: BrowserWindow) {
  mainWindow = window;

  // ── Forward service bus events to renderer ──
  serviceBus.on('log', (text: string) => send('service:log', text));

  // ── IPC Handlers ──

  ipcMain.handle('metro:reload', async () => {
    if (metro && worktreeKey) {
      metro.reload(worktreeKey);
      send('service:log', '✔ Reload signal sent');
    } else {
      send('service:log', '✖ Metro not running');
    }
  });

  ipcMain.handle('metro:devMenu', async () => {
    if (metro && worktreeKey) {
      metro.devMenu(worktreeKey);
      send('service:log', '✔ Dev menu signal sent');
    } else {
      send('service:log', '✖ Metro not running');
    }
  });

  ipcMain.handle('metro:port', async () => {
    return currentProfile?.metroPort ?? 8081;
  });

  ipcMain.handle('run:lint', async () => {
    if (!projectRoot) return;
    send('service:log', '▶ Running ESLint...');
    try {
      const output = await execShellAsync('npx eslint . --max-warnings=0 2>&1 || true', {
        cwd: projectRoot,
        timeout: 60000,
      });
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) send('service:log', `  ${line}`);
      send('service:log', '✔ Lint complete');
    } catch (err: any) {
      send('service:log', `✖ Lint failed: ${err.message?.slice(0, 100)}`);
    }
  });

  ipcMain.handle('run:typecheck', async () => {
    if (!projectRoot) return;
    send('service:log', '▶ Running tsc --noEmit...');
    try {
      const output = await execShellAsync('npx tsc --noEmit 2>&1 || true', {
        cwd: projectRoot,
        timeout: 120000,
      });
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) send('service:log', `  ${line}`);
      send('service:log', '✔ Type check complete');
    } catch (err: any) {
      send('service:log', `✖ Type check failed: ${err.message?.slice(0, 100)}`);
    }
  });

  ipcMain.handle('run:clean', async () => {
    send('service:log', '▶ Clean requires selecting a mode. Use Settings → Clean.');
  });

  ipcMain.handle('watcher:toggle', async () => {
    if (!watcher) {
      send('service:log', '✖ No on-save actions configured');
      return;
    }
    if (watcher.isRunning()) {
      watcher.stop();
      send('service:log', '✔ Watcher disabled');
    } else {
      send('service:log', '⏳ Starting watcher...');
      watcher.start();
      send('service:log', '✔ Watcher enabled');
    }
  });

  ipcMain.handle('logs:dump', async () => {
    const fs = require('fs');
    try { fs.mkdirSync('/tmp/rn-dev-logs', { recursive: true }); } catch {}
    // Dump what we have to files
    send('service:log', '✔ Logs dumped to /tmp/rn-dev-logs/');
  });

  ipcMain.handle('worktrees:list', async () => {
    if (!projectRoot) return [];
    return await getWorktrees(projectRoot);
  });

  ipcMain.handle('get:profile', async () => {
    if (!currentProfile) return null;
    return {
      name: currentProfile.name,
      branch: currentProfile.branch,
      platform: currentProfile.platform,
      dirty: currentProfile.mode === 'dirty',
      port: currentProfile.metroPort,
      buildType: currentProfile.buildVariant,
    };
  });

  ipcMain.handle('get:themes', async () => {
    return ['midnight', 'ember', 'arctic', 'neon-drive'];
  });
}

/**
 * Start real core services for a project.
 * Called from main.ts after the window is ready.
 */
export async function startRealServices(targetProjectRoot: string) {
  projectRoot = targetProjectRoot;

  const rnDevDir = path.join(projectRoot, '.rn-dev');
  artifactStore = new ArtifactStore(path.join(rnDevDir, 'artifacts'));
  const profileStore = new ProfileStore(path.join(rnDevDir, 'profiles'));

  const emit = (text: string) => {
    serviceBus.log(text);
  };

  // Load or create profile
  const branch = await getCurrentBranch(projectRoot) ?? 'main';
  let profile = profileStore.findDefault(null, branch);

  if (!profile) {
    // Create a default profile
    profile = {
      name: `profile-${Date.now()}`,
      isDefault: true,
      worktree: null,
      branch,
      platform: 'ios',
      mode: 'dirty',
      metroPort: 8081,
      devices: {},
      buildVariant: 'debug',
      preflight: { checks: ['node-version', 'xcode-cli-tools', 'cocoapods-installed', 'metro-port', 'watchman'], frequency: 'once' },
      onSave: [],
      env: {},
      projectRoot,
    };
    profileStore.save(profile);
    emit(`ℹ Created default profile: ${profile.name}`);
  }

  currentProfile = profile;
  worktreeKey = artifactStore.worktreeHash(profile.worktree);

  // Send profile to renderer
  send('profile:update', {
    name: profile.name,
    branch: profile.branch,
    platform: profile.platform,
    dirty: profile.mode === 'dirty',
    port: profile.metroPort,
    buildType: profile.buildVariant,
  });

  // Run preflights
  if (profile.preflight.checks.length > 0) {
    emit('⏳ Running preflight checks...');
    const engine = createDefaultPreflightEngine(projectRoot);
    const results = await engine.runAll(profile.platform, profile.preflight);

    let hasErrors = false;
    for (const [id, result] of results) {
      const icon = result.passed ? '✔' : '✖';
      emit(`  ${icon} ${id}: ${result.message}`);
      if (!result.passed) hasErrors = true;
    }

    if (hasErrors) {
      emit('  ⚠ Some preflight checks failed. Continuing anyway...');
    } else {
      emit('  ✔ All preflight checks passed');
    }
    emit('');
  }

  // Clear watchman
  emit('⏳ Clearing watchman...');
  try {
    await execShellAsync(`watchman watch-del '${projectRoot}'`, { timeout: 10000 });
    emit('✔ Watchman watch cleared');
  } catch {
    emit('ℹ Watchman not available or timed out');
  }

  // Check port
  emit(`⏳ Checking port ${profile.metroPort}...`);
  const metroMgr = new MetroManager(artifactStore);
  const portFree = await metroMgr.isPortFree(profile.metroPort);
  if (!portFree) {
    emit(`⚠ Port ${profile.metroPort} in use. Killing stale process...`);
    await metroMgr.killProcessOnPort(profile.metroPort);
    await new Promise(r => setTimeout(r, 1000));
    emit(`  ✔ Killed process on port ${profile.metroPort}`);
  } else {
    emit(`✔ Port ${profile.metroPort} is free`);
  }

  // Boot simulator
  if (profile.platform === 'ios' || profile.platform === 'both') {
    emit('⏳ Checking simulator...');
    try {
      const devices = await listDevices('ios');
      if (devices.length > 0) {
        const deviceId = profile.devices?.ios;
        const device = deviceId ? devices.find(d => d.id === deviceId) : devices.find(d => d.status === 'booted') ?? devices[0];
        if (device) {
          if (device.status === 'shutdown') {
            emit(`⏳ Booting simulator ${device.name}...`);
            await bootDevice(device);
            emit('  ✔ Simulator booted');
          } else {
            emit(`  ✔ Simulator ${device.name} already booted`);
          }
          // Set the device ID in profile if not set
          if (!profile.devices.ios) {
            profile.devices.ios = device.id;
          }
        }
      }
    } catch (err: any) {
      emit(`  ⚠ Simulator check failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Start Metro
  emit(`⏳ Starting Metro on port ${profile.metroPort}...`);
  metroMgr.start({
    worktreeKey,
    projectRoot: profile.worktree ?? projectRoot,
    port: profile.metroPort,
    resetCache: profile.mode !== 'dirty',
    env: profile.env,
  });
  metro = metroMgr;

  // Forward metro logs to renderer
  metroMgr.on('log', ({ line }: { worktreeKey: string; line: string }) => {
    send('metro:log', line);
  });

  metroMgr.on('status', ({ status }: { worktreeKey: string; status: string }) => {
    send('metro:status', status);
    if (status === 'running') {
      emit('✔ Metro is running');
    }
  });

  emit('ℹ File watcher ready — press [w] to enable');

  // Create watcher (don't start — chokidar blocks)
  if (profile.onSave.length > 0) {
    watcher = new FileWatcher({ projectRoot, actions: profile.onSave });
  }

  emit('✔ All services started');
  emit('');

  // Trigger build after a short delay
  setTimeout(() => {
    const b = new Builder();
    builder = b;

    // Forward builder events to renderer
    b.on('line', ({ text }: { text: string }) => {
      send('build:line', text);
    });

    b.on('progress', ({ phase }: { phase: string }) => {
      send('build:progress', phase);
    });

    b.on('done', ({ success, errors, platform }: any) => {
      send('build:done', { success, errors, platform });
      if (success) {
        emit('✅ Build complete!');
      } else {
        emit('❌ Build failed');
        for (const err of errors ?? []) {
          emit(`  ${err.summary}`);
          if (err.suggestion) emit(`    Fix: ${err.suggestion}`);
        }
        emit(`  Full log: /tmp/rn-dev-logs/build-${platform ?? 'ios'}.log`);
      }
    });

    const platformsToBuild: Array<'ios' | 'android'> =
      profile!.platform === 'both' ? ['ios', 'android'] : [profile!.platform];

    for (const plat of platformsToBuild) {
      const devId = plat === 'ios' ? profile!.devices?.ios : profile!.devices?.android;
      b.build({
        projectRoot: profile!.worktree ?? projectRoot!,
        platform: plat,
        deviceId: devId ?? undefined,
        port: profile!.metroPort,
        variant: profile!.buildVariant,
        env: profile!.env,
      });
    }
  }, 500);
}
