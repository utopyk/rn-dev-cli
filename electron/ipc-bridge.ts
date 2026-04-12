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

// ── Instance State ──

interface InstanceState {
  id: string;
  worktree: string | null;
  worktreeName: string;
  branch: string;
  port: number;
  deviceId: string | null;
  deviceName: string;
  deviceIcon: string;
  platform: 'ios' | 'android' | 'both';
  mode: string;
  metro: MetroManager | null;
  builder: Builder | null;
  serviceLog: string[];
  metroLog: string[];
  metroStatus: string;
}

interface InstanceSummary {
  id: string;
  worktreeName: string;
  branch: string;
  port: number;
  deviceName: string;
  deviceIcon: string;
  platform: string;
  metroStatus: string;
}

const instances = new Map<string, InstanceState>();
let activeInstanceId: string | null = null;

let mainWindow: BrowserWindow | null = null;
let watcher: FileWatcher | null = null;
let projectRoot: string | null = null;
let artifactStore: ArtifactStore | null = null;

const MAX_LOG_LINES = 1000;

function send(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function appendLog(instance: InstanceState, type: 'service' | 'metro', line: string) {
  const buf = type === 'service' ? instance.serviceLog : instance.metroLog;
  buf.push(line);
  if (buf.length > MAX_LOG_LINES) {
    buf.splice(0, buf.length - MAX_LOG_LINES);
  }
}

function toSummary(inst: InstanceState): InstanceSummary {
  return {
    id: inst.id,
    worktreeName: inst.worktreeName,
    branch: inst.branch,
    port: inst.port,
    deviceName: inst.deviceName,
    deviceIcon: inst.deviceIcon,
    platform: inst.platform,
    metroStatus: inst.metroStatus,
  };
}

function findFreePort(): number {
  const usedPorts = new Set<number>();
  for (const inst of instances.values()) {
    usedPorts.add(inst.port);
  }
  for (let port = 8081; port <= 8099; port++) {
    if (!usedPorts.has(port)) return port;
  }
  return 8100; // fallback
}

export function setupIpcBridge(window: BrowserWindow, initialProjectRoot?: string) {
  mainWindow = window;
  if (initialProjectRoot) {
    projectRoot = initialProjectRoot;
  }

  // ── Forward service bus events to renderer (legacy, for global logs) ──
  serviceBus.on('log', (text: string) => send('service:log', text));

  // ── Instance IPC Handlers ──

  ipcMain.handle('instances:list', async () => {
    return Array.from(instances.values()).map(toSummary);
  });

  ipcMain.handle('instances:create', async (_, profileData) => {
    if (!projectRoot) return { ok: false, error: 'No project root' };

    const worktreePath = profileData.worktree ?? null;
    const worktreeName = worktreePath ? path.basename(worktreePath) : 'main';
    // Always auto-allocate a free port to avoid conflicts between instances
    const port = findFreePort();
    const id = `${worktreeName}-${port}`;

    // Don't create duplicates
    if (instances.has(id)) {
      return { ok: false, error: `Instance ${id} already exists` };
    }

    const branch = profileData.branch ?? await getCurrentBranch(projectRoot) ?? 'main';

    // Determine device info
    let deviceName = 'No device';
    let deviceIcon = '💻';
    let deviceId: string | null = null;

    if (profileData.devices) {
      const iosDeviceId = profileData.devices.ios;
      const androidDeviceId = profileData.devices.android;
      deviceId = iosDeviceId ?? androidDeviceId ?? null;

      if (deviceId) {
        try {
          const platform = profileData.platform ?? 'ios';
          const deviceList = await listDevices(platform);
          const foundDevice = deviceList.find(d => d.id === deviceId);
          if (foundDevice) {
            deviceName = foundDevice.name;
            deviceIcon = foundDevice.isPhysical ? '📱' : '💻';
          }
        } catch {
          // Keep defaults
        }
      }
    }

    const instance: InstanceState = {
      id,
      worktree: worktreePath,
      worktreeName,
      branch,
      port,
      deviceId,
      deviceName,
      deviceIcon,
      platform: profileData.platform ?? 'ios',
      mode: profileData.mode ?? 'dirty',
      metro: null,
      builder: null,
      serviceLog: [],
      metroLog: [],
      metroStatus: 'starting',
    };

    instances.set(id, instance);
    activeInstanceId = id;

    // Notify renderer of the new instance
    send('instance:created', toSummary(instance));

    // Start services for this instance in the background
    startInstanceServices(instance, profileData).catch(err => {
      const errMsg = `Failed to start services for ${id}: ${err.message}`;
      appendLog(instance, 'service', `ERROR ${errMsg}`);
      send('instance:log', { instanceId: id, text: errMsg });
    });

    return { ok: true, instance: toSummary(instance) };
  });

  ipcMain.handle('instances:remove', async (_, instanceId: string) => {
    const instance = instances.get(instanceId);
    if (!instance) return { ok: false, error: 'Instance not found' };

    // Stop Metro
    if (instance.metro) {
      try {
        const worktreeKey = artifactStore?.worktreeHash(instance.worktree) ?? instanceId;
        instance.metro.stop(worktreeKey);
      } catch {
        // Best effort
      }
    }

    instances.delete(instanceId);

    // Switch active to another instance if needed
    if (activeInstanceId === instanceId) {
      const remaining = Array.from(instances.keys());
      activeInstanceId = remaining.length > 0 ? remaining[0] : null;
    }

    send('instance:removed', instanceId);
    return { ok: true, newActiveId: activeInstanceId };
  });

  ipcMain.handle('instances:setActive', async (_, instanceId: string) => {
    if (instances.has(instanceId)) {
      activeInstanceId = instanceId;
      return { ok: true };
    }
    return { ok: false, error: 'Instance not found' };
  });

  ipcMain.handle('instances:getActive', async () => {
    return activeInstanceId;
  });

  ipcMain.handle('instances:getLogs', async (_, instanceId: string) => {
    const instance = instances.get(instanceId);
    if (!instance) return { serviceLines: [], metroLines: [] };
    return {
      serviceLines: [...instance.serviceLog],
      metroLines: [...instance.metroLog],
    };
  });

  // ── Legacy IPC Handlers (operate on the active instance) ──

  ipcMain.handle('metro:reload', async () => {
    const instance = activeInstanceId ? instances.get(activeInstanceId) : null;
    if (instance?.metro) {
      const worktreeKey = artifactStore?.worktreeHash(instance.worktree) ?? instance.id;
      instance.metro.reload(worktreeKey);
      const msg = 'Reload signal sent';
      appendLog(instance, 'service', msg);
      send('instance:log', { instanceId: instance.id, text: msg });
    } else {
      send('service:log', 'Metro not running');
    }
  });

  ipcMain.handle('metro:devMenu', async () => {
    const instance = activeInstanceId ? instances.get(activeInstanceId) : null;
    if (instance?.metro) {
      const worktreeKey = artifactStore?.worktreeHash(instance.worktree) ?? instance.id;
      instance.metro.devMenu(worktreeKey);
      const msg = 'Dev menu signal sent';
      appendLog(instance, 'service', msg);
      send('instance:log', { instanceId: instance.id, text: msg });
    } else {
      send('service:log', 'Metro not running');
    }
  });

  ipcMain.handle('metro:port', async () => {
    const instance = activeInstanceId ? instances.get(activeInstanceId) : null;
    return instance?.port ?? 8081;
  });

  ipcMain.handle('run:lint', async () => {
    if (!projectRoot) return;
    const instance = activeInstanceId ? instances.get(activeInstanceId) : null;
    const emitLog = (text: string) => {
      if (instance) {
        appendLog(instance, 'service', text);
        send('instance:log', { instanceId: instance.id, text });
      } else {
        send('service:log', text);
      }
    };
    emitLog('Running ESLint...');
    try {
      const cwd = instance?.worktree ?? projectRoot;
      const output = await execShellAsync('npx eslint . --max-warnings=0 2>&1 || true', {
        cwd,
        timeout: 60000,
      });
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) emitLog(`  ${line}`);
      emitLog('Lint complete');
    } catch (err: any) {
      emitLog(`Lint failed: ${err.message?.slice(0, 100)}`);
    }
  });

  ipcMain.handle('run:typecheck', async () => {
    if (!projectRoot) return;
    const instance = activeInstanceId ? instances.get(activeInstanceId) : null;
    const emitLog = (text: string) => {
      if (instance) {
        appendLog(instance, 'service', text);
        send('instance:log', { instanceId: instance.id, text });
      } else {
        send('service:log', text);
      }
    };
    emitLog('Running tsc --noEmit...');
    try {
      const cwd = instance?.worktree ?? projectRoot;
      const output = await execShellAsync('npx tsc --noEmit 2>&1 || true', {
        cwd,
        timeout: 120000,
      });
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) emitLog(`  ${line}`);
      emitLog('Type check complete');
    } catch (err: any) {
      emitLog(`Type check failed: ${err.message?.slice(0, 100)}`);
    }
  });

  ipcMain.handle('run:clean', async () => {
    send('service:log', 'Clean requires selecting a mode. Use Settings > Clean.');
  });

  ipcMain.handle('watcher:toggle', async () => {
    if (!watcher) {
      send('service:log', 'No on-save actions configured');
      return;
    }
    if (watcher.isRunning()) {
      watcher.stop();
      send('service:log', 'Watcher disabled');
    } else {
      send('service:log', 'Starting watcher...');
      watcher.start();
      send('service:log', 'Watcher enabled');
    }
  });

  ipcMain.handle('logs:dump', async () => {
    const fs = require('fs');
    try { fs.mkdirSync('/tmp/rn-dev-logs', { recursive: true }); } catch {}
    send('service:log', 'Logs dumped to /tmp/rn-dev-logs/');
  });

  ipcMain.handle('worktrees:list', async () => {
    if (!projectRoot) return [];
    return await getWorktrees(projectRoot);
  });

  ipcMain.handle('get:profile', async () => {
    const instance = activeInstanceId ? instances.get(activeInstanceId) : null;
    if (!instance) return null;
    return {
      name: instance.id,
      branch: instance.branch,
      platform: instance.platform,
      dirty: instance.mode === 'dirty',
      port: instance.port,
      buildType: 'debug',
    };
  });

  ipcMain.handle('get:themes', async () => {
    return ['midnight', 'ember', 'arctic', 'neon-drive'];
  });

  // ── Wizard IPC Handlers ──

  ipcMain.handle('wizard:hasProfile', async () => {
    if (!projectRoot) return false;
    const profileStore = new ProfileStore(path.join(projectRoot, '.rn-dev', 'profiles'));
    const branch = await getCurrentBranch(projectRoot) ?? 'main';
    return profileStore.findDefault(null, branch) !== null;
  });

  ipcMain.handle('wizard:getWorktrees', async () => {
    if (!projectRoot) return [];
    const worktrees = await getWorktrees(projectRoot);
    return worktrees.map(wt => ({
      name: wt.isMain ? 'Default (root)' : path.basename(wt.path),
      path: wt.path,
      branch: wt.branch,
      isMain: wt.isMain,
    }));
  });

  ipcMain.handle('wizard:getBranches', async () => {
    if (!projectRoot) return [];
    try {
      const output = await execShellAsync(
        'git for-each-ref --sort=-committerdate --format="%(refname:short)" refs/heads/ | head -20',
        { cwd: projectRoot, timeout: 5000 }
      );
      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  });

  ipcMain.handle('wizard:getDevices', async (_, platform: string) => {
    console.log(`[ipc] wizard:getDevices called with platform: ${platform}`);
    try {
      const devices = await listDevices((platform ?? 'both') as any);
      console.log(`[ipc] Found ${devices.length} devices`);
      return devices.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        runtime: d.runtime,
        isPhysical: d.isPhysical ?? false,
      }));
    } catch (err: any) {
      console.error(`[ipc] wizard:getDevices error:`, err.message);
      return [];
    }
  });

  ipcMain.handle('wizard:getTooling', async () => {
    if (!projectRoot) return [];
    try {
      const { detectTooling } = await import('../src/core/tooling-detector.js');
      return detectTooling(projectRoot);
    } catch {
      return [];
    }
  });

  ipcMain.handle('wizard:getPreflightChecks', async () => {
    return [
      { id: 'node-version', label: 'Node.js version', platform: 'all' },
      { id: 'ruby-version', label: 'Ruby version', platform: 'all' },
      { id: 'xcode-cli-tools', label: 'Xcode CLI tools', platform: 'ios' },
      { id: 'cocoapods-installed', label: 'CocoaPods', platform: 'ios' },
      { id: 'podfile-lock-sync', label: 'Podfile.lock sync', platform: 'ios' },
      { id: 'watchman', label: 'Watchman', platform: 'all' },
      { id: 'node-modules-sync', label: 'node_modules sync', platform: 'all' },
      { id: 'metro-port', label: 'Metro port available', platform: 'all' },
      { id: 'env-file', label: '.env file', platform: 'all' },
      { id: 'patch-package', label: 'patch-package', platform: 'all' },
    ];
  });

  ipcMain.handle('wizard:saveProfile', async (_, profileData) => {
    if (!projectRoot) return { ok: false, error: 'No project root' };
    const profile = { ...profileData, projectRoot };
    const profileStore = new ProfileStore(path.join(projectRoot, '.rn-dev', 'profiles'));
    profileStore.save(profile);
    return { ok: true };
  });
}

// ── Start services for a single instance ──

async function startInstanceServices(instance: InstanceState, profileData: any) {
  if (!projectRoot || !artifactStore) return;

  const emit = (text: string) => {
    appendLog(instance, 'service', text);
    send('instance:log', { instanceId: instance.id, text });
  };

  const rnDevDir = path.join(projectRoot, '.rn-dev');
  const profileStore = new ProfileStore(path.join(rnDevDir, 'profiles'));

  // Build a profile object
  const profile: Profile = {
    name: profileData.name ?? instance.id,
    isDefault: profileData.isDefault ?? true,
    worktree: instance.worktree,
    branch: instance.branch,
    platform: instance.platform,
    mode: instance.mode,
    metroPort: instance.port,
    devices: profileData.devices ?? {},
    buildVariant: profileData.buildVariant ?? 'debug',
    preflight: profileData.preflight ?? { checks: [], frequency: 'once' },
    onSave: profileData.onSave ?? [],
    env: profileData.env ?? {},
    projectRoot,
  };

  const worktreeKey = artifactStore.worktreeHash(instance.worktree);

  // Run preflights
  if (profile.preflight.checks.length > 0) {
    emit('Running preflight checks...');
    const engine = createDefaultPreflightEngine(projectRoot);
    const results = await engine.runAll(profile.platform, profile.preflight);

    let hasErrors = false;
    for (const [id, result] of results) {
      const icon = result.passed ? '  OK' : '  FAIL';
      emit(`${icon} ${id}: ${result.message}`);
      if (!result.passed) hasErrors = true;
    }

    if (hasErrors) {
      emit('  Some preflight checks failed. Continuing anyway...');
    } else {
      emit('  All preflight checks passed');
    }
    emit('');
  }

  // Check port
  emit(`Checking port ${instance.port}...`);
  const metroMgr = new MetroManager(artifactStore);
  const portFree = await metroMgr.isPortFree(instance.port);
  if (!portFree) {
    emit(`Port ${instance.port} in use. Killing stale process...`);
    await metroMgr.killProcessOnPort(instance.port);
    await new Promise(r => setTimeout(r, 1000));
    emit(`  Killed process on port ${instance.port}`);
  } else {
    emit(`Port ${instance.port} is free`);
  }

  // Boot simulator if needed
  if (instance.platform === 'ios' || instance.platform === 'both') {
    emit('Checking simulator...');
    try {
      const devices = await listDevices('ios');
      if (devices.length > 0) {
        const deviceId = profile.devices?.ios;
        const device = deviceId
          ? devices.find(d => d.id === deviceId)
          : devices.find(d => d.status === 'booted') ?? devices[0];
        if (device) {
          if (device.status === 'shutdown') {
            emit(`Booting simulator ${device.name}...`);
            await bootDevice(device);
            emit('  Simulator booted');
          } else {
            emit(`  Simulator ${device.name} already booted`);
          }
          instance.deviceId = device.id;
          instance.deviceName = device.name;
          instance.deviceIcon = device.isPhysical ? '📱' : '💻';
          // Update renderer with device info
          send('instance:status', { instanceId: instance.id, ...toSummary(instance) });
        }
      }
    } catch (err: any) {
      emit(`  Simulator check failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Start Metro
  emit(`Starting Metro on port ${instance.port}...`);
  instance.metroStatus = 'starting';
  send('instance:status', { instanceId: instance.id, ...toSummary(instance) });

  metroMgr.start({
    worktreeKey,
    projectRoot: instance.worktree ?? projectRoot,
    port: instance.port,
    resetCache: instance.mode !== 'dirty',
    env: profile.env,
  });
  instance.metro = metroMgr;

  // Forward metro logs
  metroMgr.on('log', ({ line }: { worktreeKey: string; line: string }) => {
    appendLog(instance, 'metro', line);
    send('instance:metro', { instanceId: instance.id, text: line });
  });

  metroMgr.on('status', ({ status }: { worktreeKey: string; status: string }) => {
    instance.metroStatus = status;
    send('instance:status', { instanceId: instance.id, ...toSummary(instance) });
    if (status === 'running') {
      emit('Metro is running');
    }
  });

  emit('All services started');
  emit('');

  // Trigger build
  setTimeout(() => {
    const b = new Builder();
    instance.builder = b;

    b.on('line', ({ text }: { text: string }) => {
      appendLog(instance, 'service', text);
      send('instance:build:line', { instanceId: instance.id, text });
    });

    b.on('progress', ({ phase }: { phase: string }) => {
      send('instance:build:progress', { instanceId: instance.id, phase });
    });

    b.on('done', ({ success, errors, platform }: any) => {
      send('instance:build:done', { instanceId: instance.id, success, errors, platform });
      if (success) {
        emit('Build complete!');
      } else {
        emit('Build failed');
        for (const err of errors ?? []) {
          emit(`  ${err.summary}`);
          if (err.suggestion) emit(`    Fix: ${err.suggestion}`);
        }
      }
    });

    const platformsToBuild: Array<'ios' | 'android'> =
      profile.platform === 'both' ? ['ios', 'android'] : [profile.platform];

    for (const plat of platformsToBuild) {
      const devId = plat === 'ios' ? profile.devices?.ios : profile.devices?.android;
      b.build({
        projectRoot: instance.worktree ?? projectRoot!,
        platform: plat,
        deviceId: devId ?? undefined,
        port: instance.port,
        variant: profile.buildVariant,
        env: profile.env,
      });
    }
  }, 500);
}

/**
 * Start real core services for a project.
 * Called from main.ts after the window is ready.
 * Creates the first instance automatically from the default profile (or triggers wizard).
 */
export async function startRealServices(targetProjectRoot: string) {
  projectRoot = targetProjectRoot;

  const rnDevDir = path.join(projectRoot, '.rn-dev');
  artifactStore = new ArtifactStore(path.join(rnDevDir, 'artifacts'));
  const profileStore = new ProfileStore(path.join(rnDevDir, 'profiles'));

  // Load or create profile
  const branch = await getCurrentBranch(projectRoot) ?? 'main';
  let profile = profileStore.findDefault(null, branch);

  if (!profile) {
    // No profile — renderer will show the wizard
    // The wizard completion will call instances:create
    return;
  }

  // Create the first instance from the default profile
  const worktreePath = profile.worktree ?? null;
  const worktreeName = worktreePath ? path.basename(worktreePath) : 'main';
  const port = profile.metroPort ?? 8081;
  const id = `${worktreeName}-${port}`;

  let deviceName = 'No device';
  let deviceIcon = '💻';
  let deviceId: string | null = null;

  if (profile.devices) {
    deviceId = profile.devices.ios ?? profile.devices.android ?? null;
    if (deviceId) {
      try {
        const deviceList = await listDevices(profile.platform);
        const foundDevice = deviceList.find(d => d.id === deviceId);
        if (foundDevice) {
          deviceName = foundDevice.name;
          deviceIcon = foundDevice.isPhysical ? '📱' : '💻';
        }
      } catch { /* keep defaults */ }
    }
  }

  const instance: InstanceState = {
    id,
    worktree: worktreePath,
    worktreeName,
    branch: profile.branch,
    port,
    deviceId,
    deviceName,
    deviceIcon,
    platform: profile.platform,
    mode: profile.mode,
    metro: null,
    builder: null,
    serviceLog: [],
    metroLog: [],
    metroStatus: 'starting',
  };

  instances.set(id, instance);
  activeInstanceId = id;

  send('instance:created', toSummary(instance));

  // Start services
  await startInstanceServices(instance, {
    ...profile,
    devices: profile.devices,
  });
}
