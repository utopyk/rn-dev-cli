import React from 'react';
import type { ViewTab } from '../types';
import './StatusBar.css';

interface StatusBarProps {
  metroStatus: 'running' | 'starting' | 'stopped' | 'error';
  metroPort: number;
  watcherOn: boolean;
  activeTab: ViewTab;
}

const tabLabels: Record<ViewTab, string> = {
  'dev-space': 'Dev Space',
  'devtools': 'DevTools',
  'lint-test': 'Lint & Test',
  'metro-logs': 'Metro Logs',
  'settings': 'Settings',
};

export function StatusBar({ metroStatus, metroPort, watcherOn, activeTab }: StatusBarProps) {
  return (
    <div className="bottom-bar">
      <div className="shortcuts-bar">
        <span><span className="key">[r]</span> Reload</span>
        <span><span className="key">[d]</span> DevMenu</span>
        <span><span className="key">[l]</span> Lint</span>
        <span><span className="key">[t]</span> TypeChk</span>
        <span><span className="key">[c]</span> Clean</span>
        <span><span className="key">[f]</span> Focus</span>
        <span><span className="key">[q]</span> Quit</span>
      </div>
      <div className="status-right">
        <span>
          Metro: <span className={`status-dot ${metroStatus}`} />
          {metroStatus === 'running' ? `Running :${metroPort}` : metroStatus}
        </span>
        <span className="sep">|</span>
        <span>
          Watcher:{' '}
          <span style={{ color: watcherOn ? 'var(--success)' : 'var(--muted)', fontWeight: 'bold' }}>
            {watcherOn ? 'ON' : 'OFF'}
          </span>
        </span>
        <span className="sep">|</span>
        <span>
          Module: <span style={{ color: 'var(--accent)' }}>{tabLabels[activeTab]}</span>
        </span>
      </div>
    </div>
  );
}
