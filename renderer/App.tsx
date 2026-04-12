import React, { useState, useCallback, useEffect } from 'react';
import type { ViewTab, ProfileInfo } from './types';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { ProfileBanner } from './components/ProfileBanner';
import { DevSpace } from './views/DevSpace';
import { LintTest } from './views/LintTest';
import { MetroLogs } from './views/MetroLogs';
import { Settings } from './views/Settings';
import { useIpcOn, useIpcInvoke } from './hooks/useIpc';
import { useSimulatedLogs } from './hooks/useSimulatedLogs';
import './App.css';

const defaultProfile: ProfileInfo = {
  name: 'my-profile',
  branch: 'main',
  platform: 'ios',
  dirty: true,
  port: 8081,
  buildType: 'debug',
};

export function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('dev-space');
  const [profileVisible, setProfileVisible] = useState(true);
  const [profile] = useState<ProfileInfo>(defaultProfile);

  const [serviceLines, setServiceLines] = useState<string[]>([]);
  const [metroLines, setMetroLines] = useState<string[]>([]);

  const invoke = useIpcInvoke();

  // Stable callbacks for log appending
  const addServiceLog = useCallback((line: string) => {
    setServiceLines((prev) => [...prev, line]);
  }, []);

  const addMetroLog = useCallback((line: string) => {
    setMetroLines((prev) => [...prev, line]);
  }, []);

  // IPC listeners (Electron mode)
  useIpcOn('service:log', addServiceLog);
  useIpcOn('metro:log', addMetroLog);
  useIpcOn('build:line', addServiceLog);

  // Simulated logs (browser-only mode)
  useSimulatedLogs(addServiceLog, addMetroLog, addServiceLog);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when selecting text or typing in inputs
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'r':
          invoke('metro:reload');
          addServiceLog('> Reloading app...');
          setTimeout(() => addServiceLog('> App reloaded'), 300);
          break;
        case 'd':
          invoke('metro:devMenu');
          addServiceLog('> Opening dev menu...');
          break;
        case 'l':
          invoke('run:lint');
          addServiceLog('> Running ESLint...');
          setTimeout(() => {
            addServiceLog('  src/App.tsx: 0 errors, 2 warnings');
            addServiceLog('> Lint complete: 0 errors, 2 warnings');
          }, 500);
          break;
        case 't':
          invoke('run:typecheck');
          addServiceLog('> Running tsc --noEmit...');
          setTimeout(() => addServiceLog('> Type check passed'), 400);
          break;
        case 'c':
          invoke('run:clean');
          addServiceLog('> Cleaning build artifacts...');
          setTimeout(() => addServiceLog('> Clean complete'), 600);
          break;
        case 'w':
          invoke('watcher:toggle');
          break;
        case 'o':
          invoke('logs:dump');
          addServiceLog('> Dumping logs to file...');
          setTimeout(() => addServiceLog('> Logs written to .rn-dev/build.log'), 200);
          break;
        case 'f':
          // Focus toggle is handled inside DevSpace
          break;
        case 'p':
          setProfileVisible((v) => !v);
          break;
        case 'q':
          window.close();
          break;
        case 'Tab':
          e.preventDefault();
          const tabs: ViewTab[] = ['dev-space', 'lint-test', 'metro-logs', 'settings'];
          const idx = tabs.indexOf(activeTab);
          setActiveTab(tabs[(idx + 1) % tabs.length]);
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeTab, invoke, addServiceLog]);

  const renderView = () => {
    switch (activeTab) {
      case 'dev-space':
        return <DevSpace serviceLines={serviceLines} metroLines={metroLines} />;
      case 'lint-test':
        return <LintTest />;
      case 'metro-logs':
        return <MetroLogs lines={metroLines} />;
      case 'settings':
        return <Settings />;
    }
  };

  return (
    <div className="app-root">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="app-main">
        <ProfileBanner
          profile={profile}
          visible={profileVisible}
          onToggle={() => setProfileVisible((v) => !v)}
        />
        <div className="app-content">
          {renderView()}
        </div>
        <StatusBar
          metroStatus="running"
          metroPort={profile.port}
          watcherOn={true}
          activeTab={activeTab}
        />
      </div>
    </div>
  );
}
