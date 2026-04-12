import React from 'react';
import type { ViewTab } from '../types';
import './Sidebar.css';

interface ModuleItem {
  id: ViewTab;
  icon: string;
  label: string;
}

interface ShortcutItem {
  key: string;
  label: string;
  command: string | null;
}

const modules: ModuleItem[] = [
  { id: 'dev-space', icon: '🚀', label: 'Dev Space' },
  { id: 'devtools', icon: '🔧', label: 'DevTools' },
  { id: 'lint-test', icon: '🧪', label: 'Lint & Test' },
  { id: 'metro-logs', icon: '📡', label: 'Metro Logs' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

const shortcuts: ShortcutItem[] = [
  { key: 'r', label: 'Reload', command: 'metro:reload' },
  { key: 'd', label: 'Dev Menu', command: 'metro:devMenu' },
  { key: 'l', label: 'Lint', command: 'run:lint' },
  { key: 't', label: 'Type Check', command: 'run:typecheck' },
  { key: 'c', label: 'Clean', command: 'run:clean' },
  { key: 'w', label: 'Watcher', command: 'watcher:toggle' },
  { key: 'o', label: 'Dump Logs', command: 'logs:dump' },
];

interface SidebarProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  onShortcut: (command: string) => void;
  onOpenWizard?: () => void;
}

export function Sidebar({ activeTab, onTabChange, onShortcut, onOpenWizard }: SidebarProps) {
  return (
    <div className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-l1">╦═╗╔╗╗  ╦═╗╔═╗╦  ╦</div>
        <div className="logo-l2">╠╦╝║║║  ║ ║╠═  ║║</div>
        <div className="logo-l3">╩╚═╝╚╝  ╩═╝╚═╝ ╚╝</div>
      </div>

      {/* Modules */}
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

      {/* Shortcuts */}
      <div className="sidebar-section sidebar-shortcuts">
        <div className="sidebar-section-title">SHORTCUTS</div>
        {shortcuts.map((s) => (
          <button
            key={s.key}
            className="sidebar-shortcut"
            onClick={() => s.command && onShortcut(s.command)}
          >
            <span className="shortcut-key">[{s.key}]</span>
            <span className="shortcut-label">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        {onOpenWizard && (
          <button className="sidebar-new-worktree" onClick={onOpenWizard}>
            Setup Wizard
          </button>
        )}
      </div>
    </div>
  );
}
