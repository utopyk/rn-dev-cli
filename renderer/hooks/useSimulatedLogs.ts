import { useEffect } from 'react';

export interface SimulatedSectionEvent {
  type: 'section:start' | 'section:end';
  id: string;
  title?: string;
  icon?: string;
  status?: 'ok' | 'warning' | 'error';
}

/**
 * When running outside Electron (no window.rndev), pump simulated logs
 * so the UI is fully functional in a plain browser for development.
 */
export function useSimulatedLogs(
  addServiceLog: (line: string) => void,
  addMetroLog: (line: string) => void,
  addBuildLine: (line: string) => void,
  onSectionEvent?: (event: SimulatedSectionEvent) => void,
) {
  useEffect(() => {
    // Only simulate when not in Electron
    if (window.rndev) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let delay = 200;

    function schedule(fn: () => void, extraDelay = 0) {
      delay += extraDelay;
      timers.push(setTimeout(fn, delay));
    }

    // ── Preflight section ──
    schedule(() => onSectionEvent?.({ type: 'section:start', id: 'preflight', title: 'Preflight Checks', icon: '\u23F3' }), 0);

    const preflightLines = [
      '> Running preflight checks...',
      '  > node-version: v22.16.0',
      '  > ruby-version: 3.2.2',
      '  > xcode-cli-tools: found',
      '  > cocoapods-installed: 1.16.2',
      '  > podfile-lock-sync: OK',
      '  > watchman: installed',
      '  > node-modules-sync: OK',
      '  > metro-port: 8081 free',
    ];

    for (const line of preflightLines) {
      schedule(() => addServiceLog(line), 50 + Math.random() * 30);
    }

    schedule(() => onSectionEvent?.({ type: 'section:end', id: 'preflight', status: 'ok' }), 30);
    schedule(() => addServiceLog(''), 10);

    // ── Watchman section ──
    schedule(() => onSectionEvent?.({ type: 'section:start', id: 'watchman', title: 'Watchman Clear', icon: '\u23F3' }), 50);
    schedule(() => addServiceLog('> Watchman watch cleared'), 80);
    schedule(() => onSectionEvent?.({ type: 'section:end', id: 'watchman', status: 'ok' }), 30);
    schedule(() => addServiceLog(''), 10);

    // ── Metro section ──
    schedule(() => onSectionEvent?.({ type: 'section:start', id: 'metro', title: 'Metro Start', icon: '\u23F3' }), 50);
    schedule(() => addServiceLog('> Starting Metro on port 8081...'), 60);
    schedule(() => addServiceLog('> Simulator iPhone 16 Pro already booted'), 40);
    schedule(() => addServiceLog('> All services started'), 30);
    schedule(() => onSectionEvent?.({ type: 'section:end', id: 'metro', status: 'ok' }), 50);
    schedule(() => addServiceLog(''), 10);

    // ── Build section ──
    schedule(() => onSectionEvent?.({ type: 'section:start', id: 'build', title: 'Build for iOS', icon: '\u23F3' }), 100);
    schedule(() => addServiceLog('> Building for ios...'), 30);
    schedule(() => addServiceLog('  npx react-native run-ios --port 8081 --verbose --udid 3BB933F3...'), 20);
    schedule(() => addServiceLog('  info Found Xcode workspace "MovieNightsClub.xcworkspace"'), 30);
    schedule(() => addServiceLog('  info Building (using xcodebuild -workspace ...)'), 30);

    for (let i = 1; i <= 40; i++) {
      let line: string;
      if (i % 12 === 0) {
        line = `  WARNING ld: warning: object file libPods-${i}.a built for newer version`;
      } else if (i % 18 === 0) {
        line = `  ERROR error: Module 'React_${i}' not found`;
      } else {
        line = `  [${i}/111] CompileC Module${i}.swift`;
      }
      schedule(() => addBuildLine(line), 20 + Math.random() * 15);
    }

    schedule(() => addBuildLine('  > Build Succeeded'), 30);
    schedule(() => addBuildLine('  > Installing on iPhone 16 Pro...'), 20);
    schedule(() => addBuildLine('  > Launching com.movienightsclub.app'), 20);
    schedule(() => addBuildLine('> Build complete!'), 20);
    schedule(() => onSectionEvent?.({ type: 'section:end', id: 'build', status: 'ok' }), 30);

    // Metro logs (independent timeline)
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

    metroLines.forEach((line, i) => {
      timers.push(setTimeout(() => addMetroLog(line), 400 + i * 40));
    });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);
}
