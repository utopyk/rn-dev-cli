import React from 'react';
import type { ViewTab } from '../types';
import './Sidebar.css';

interface WorktreeItem {
  name: string;
  status: 'running' | 'starting' | 'stopped' | 'error';
}

interface ModuleItem {
  id: ViewTab;
  icon: string;
  label: string;
}

const worktrees: WorktreeItem[] = [
  { name: 'main', status: 'running' },
  { name: 'feature/auth', status: 'stopped' },
  { name: 'fix/crash-on-boot', status: 'error' },
];

const modules: ModuleItem[] = [
  { id: 'dev-space', icon: '>', label: 'Dev Space' },
  { id: 'lint-test', icon: '>', label: 'Lint & Test' },
  { id: 'metro-logs', icon: '>', label: 'Metro Logs' },
  { id: 'settings', icon: '>', label: 'Settings' },
];

interface SidebarProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-title">WORKTREES</div>
        {worktrees.map((wt) => (
          <div key={wt.name} className="sidebar-item">
            <span className={`status-dot ${wt.status}`} />
            <span className="sidebar-item-label">{wt.name}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">MODULES</div>
        {modules.map((mod) => (
          <button
            key={mod.id}
            className={`sidebar-item sidebar-module${activeTab === mod.id ? ' active' : ''}`}
            onClick={() => onTabChange(mod.id)}
          >
            <span className="sidebar-module-icon">{mod.icon}</span>
            <span className="sidebar-item-label">{mod.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-new-worktree">+ New Worktree</button>
      </div>
    </div>
  );
}
