import { useEffect } from 'react';

/**
 * When running outside Electron (no window.rndev), pump simulated logs
 * so the UI is fully functional in a plain browser for development.
 */
export function useSimulatedLogs(
  addServiceLog: (line: string) => void,
  addMetroLog: (line: string) => void,
  addBuildLine: (line: string) => void,
) {
  useEffect(() => {
    // Only simulate when not in Electron
    if (window.rndev) return;

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

    const timers: ReturnType<typeof setTimeout>[] = [];

    let delay = 200;
    startupLines.forEach((line) => {
      delay += 50 + Math.random() * 30;
      timers.push(setTimeout(() => addServiceLog(line), delay));
    });

    delay += 200;
    buildLines.forEach((line) => {
      delay += 20 + Math.random() * 15;
      timers.push(setTimeout(() => addBuildLine(line), delay));
    });

    metroLines.forEach((line, i) => {
      timers.push(setTimeout(() => addMetroLog(line), 400 + i * 40));
    });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);
}
