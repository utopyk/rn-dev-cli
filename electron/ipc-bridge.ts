import { ipcMain, BrowserWindow } from 'electron';

// In production, this would import the real serviceBus:
// import { serviceBus } from '../src/app/service-bus.js';

let mainWindow: BrowserWindow | null = null;

function send(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

export function setupIpcBridge(window: BrowserWindow) {
  mainWindow = window;

  // ── IPC Handlers (commands from renderer) ──

  ipcMain.handle('metro:reload', async () => {
    send('service:log', '> Reloading app...');
    setTimeout(() => send('service:log', '> App reloaded'), 300);
    return { ok: true };
  });

  ipcMain.handle('metro:devMenu', async () => {
    send('service:log', '> Opening dev menu...');
    return { ok: true };
  });

  ipcMain.handle('run:lint', async () => {
    send('service:log', '> Running ESLint...');
    setTimeout(() => {
      send('service:log', '  src/App.tsx: 0 errors, 2 warnings');
      send('service:log', '> Lint complete: 0 errors, 2 warnings');
    }, 500);
    return { ok: true };
  });

  ipcMain.handle('run:typecheck', async () => {
    send('service:log', '> Running tsc --noEmit...');
    setTimeout(() => {
      send('service:log', '> Type check passed');
    }, 400);
    return { ok: true };
  });

  ipcMain.handle('run:clean', async () => {
    send('service:log', '> Cleaning build artifacts...');
    setTimeout(() => {
      send('service:log', '> Clean complete');
    }, 600);
    return { ok: true };
  });

  ipcMain.handle('watcher:toggle', async () => {
    send('service:log', '> Toggling file watcher...');
    return { ok: true };
  });

  ipcMain.handle('logs:dump', async () => {
    send('service:log', '> Dumping logs to file...');
    setTimeout(() => {
      send('service:log', '> Logs written to .rn-dev/build.log');
    }, 200);
    return { ok: true };
  });

  ipcMain.handle('get:themes', async () => {
    // Return available themes
    return ['midnight', 'ember', 'arctic', 'neon-drive'];
  });

  ipcMain.handle('get:profile', async () => {
    return {
      name: 'my-profile',
      branch: 'main',
      platform: 'ios',
      dirty: true,
      port: 8081,
      buildType: 'debug',
    };
  });

  // ── Simulate startup logs ──
  simulateStartupLogs();
}

function simulateStartupLogs() {
  const startupLines = [
    '> Running preflight checks...',
    '  > node-version: v22.16.0',
    '  > ruby-version: 3.2.2',
    '  > xcode-cli-tools: found',
    '  > cocoapods-installed: 1.16.2',
    '  > podfile-lock-sync: OK',
    '  > watchman: installed',
    '  > node-modules-sync: OK',
    '  > metro-port: 8081 free',
    '',
    '> Watchman watch cleared',
    '> Starting Metro on port 8081...',
    '> Simulator iPhone 16 Pro already booted',
    '> All services started',
    '',
    '> Building for ios...',
    '  npx react-native run-ios --port 8081 --verbose --udid 3BB933F3...',
    '  info Found Xcode workspace "MovieNightsClub.xcworkspace"',
    '  info Building (using xcodebuild -workspace ...)',
  ];

  const buildLines: string[] = [];
  for (let i = 1; i <= 40; i++) {
    if (i % 12 === 0) {
      buildLines.push(`  WARNING ld: warning: object file libPods-${i}.a built for newer version`);
    } else if (i % 18 === 0) {
      buildLines.push(`  ERROR error: Module 'React_${i}' not found`);
    } else {
      buildLines.push(`  [${i}/111] CompileC Module${i}.swift`);
    }
  }
  buildLines.push('  > Build Succeeded');
  buildLines.push('  > Installing on iPhone 16 Pro...');
  buildLines.push('  > Launching com.movienightsclub.app');
  buildLines.push('> Build complete!');

  const metroLines = [
    'Welcome to React Native v0.84',
    'Starting dev server on http://localhost:8081',
    '',
    '    Welcome to Metro v0.83.5',
    '    Fast - Scalable - Integrated',
    '',
    'INFO  Dev server ready. Press Ctrl+C to exit.',
    '',
  ];
  for (let i = 1; i <= 30; i++) {
    metroLines.push(
      i % 8 === 0
        ? 'WARN  Require cycle: A.tsx -> B.tsx -> A.tsx'
        : `LOG   Running "MovieNightsClub" with {"rootTag":${i + 10}}`
    );
  }

  let delay = 500; // give renderer time to mount
  startupLines.forEach((line) => {
    delay += 50 + Math.random() * 30;
    setTimeout(() => send('service:log', line), delay);
  });

  delay += 200;
  buildLines.forEach((line) => {
    delay += 20 + Math.random() * 15;
    setTimeout(() => send('build:line', line), delay);
  });

  metroLines.forEach((line, i) => {
    setTimeout(() => send('metro:log', line), 700 + i * 40);
  });
}
