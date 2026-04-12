import React, { useState, useCallback } from 'react';
import { LogPanel } from '../components/LogPanel';
import { useIpcInvoke } from '../hooks/useIpc';
import './DevSpace.css';

interface DevSpaceProps {
  serviceLines: string[];
  metroLines: string[];
}

const shortcuts = [
  { key: '[r]', label: 'Reload', command: 'metro:reload' },
  { key: '[d]', label: 'Dev Menu', command: 'metro:devMenu' },
  { key: '[l]', label: 'Lint', command: 'run:lint' },
  { key: '[t]', label: 'Type Check', command: 'run:typecheck' },
  { key: '[c]', label: 'Clean', command: 'run:clean' },
  { key: '[w]', label: 'Toggle Watcher', command: 'watcher:toggle' },
  { key: '[o]', label: 'Dump Logs', command: 'logs:dump' },
  { key: '[q]', label: 'Quit', command: null },
] as const;

export function DevSpace({ serviceLines, metroLines }: DevSpaceProps) {
  const [focusedPanel, setFocusedPanel] = useState<'tool' | 'metro'>('tool');
  const [feedback, setFeedback] = useState('');
  const invoke = useIpcInvoke();

  const showFeedback = useCallback((msg: string) => {
    setFeedback('> ' + msg);
    setTimeout(() => setFeedback(''), 2000);
  }, []);

  const handleShortcut = useCallback((command: string | null, label: string) => {
    if (!command) {
      window.close();
      return;
    }
    showFeedback(`${label}...`);
    invoke(command);
  }, [invoke, showFeedback]);

  return (
    <div className="dev-space">
      <div className="shortcuts-panel">
        <div className="logo">
          <div className="l1">{'\u2566\u2550\u2557\u2554\u2557\u2557  \u2566\u2550\u2557\u2554\u2550\u2557\u2566  \u2566'}</div>
          <div className="l2">{'\u2560\u2566\u255D\u2551\u2551\u2551  \u2551 \u2551\u2560\u2550  \u2551\u2551'}</div>
          <div className="l3">{'\u2569\u255A\u2550\u255D\u255A\u255D  \u2569\u2550\u255D\u255A\u2550\u255D \u255A\u255D'}</div>
        </div>

        {shortcuts.map((s) => (
          <button
            key={s.key}
            className="shortcut-item"
            onClick={() => handleShortcut(s.command, s.label)}
          >
            <span className="shortcut-key">{s.key}</span>
            <span className="shortcut-label">{s.label}</span>
          </button>
        ))}

        <div className="shortcut-meta">
          [f] focus [Tab] switch tab<br />[p] toggle profile
        </div>

        <div className="shortcut-feedback">{feedback}</div>
      </div>

      <div className="right-panels">
        <LogPanel
          title="Tool Output"
          lines={serviceLines}
          focused={focusedPanel === 'tool'}
          onFocus={() => setFocusedPanel('tool')}
        />
        <LogPanel
          title="Metro Output"
          lines={metroLines}
          focused={focusedPanel === 'metro'}
          onFocus={() => setFocusedPanel('metro')}
        />
      </div>
    </div>
  );
}
