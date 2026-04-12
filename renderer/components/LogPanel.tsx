import React, { useRef, useEffect } from 'react';
import './LogPanel.css';

interface LogPanelProps {
  title: string;
  lines: string[];
  focused?: boolean;
  onFocus?: () => void;
  className?: string;
}

/** Strip ANSI escape codes from text */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function getLineClass(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('>') && (trimmed.includes('Succeeded') || trimmed.includes('complete') || trimmed.includes('passed') || trimmed.includes('reloaded'))) return 'log-success';
  if (trimmed.startsWith('>') && !trimmed.includes('ERROR') && !trimmed.includes('WARNING')) return 'log-info';
  if (trimmed.startsWith('ERROR') || trimmed.includes('error:') || trimmed.includes('not found')) return 'log-error';
  if (trimmed.startsWith('WARNING') || trimmed.startsWith('WARN') || trimmed.includes('warning:')) return 'log-warning';
  if (trimmed.startsWith('INFO')) return 'log-info';
  if (trimmed.startsWith('[') || trimmed.startsWith('info ') || trimmed.startsWith('npx ')) return 'log-muted';
  if (trimmed.startsWith('LOG')) return 'log-default';
  if (trimmed === '') return 'log-default';
  return 'log-default';
}

export function LogPanel({ title, lines, focused = false, onFocus, className }: LogPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className={`panel${focused ? ' focused' : ''}${className ? ' ' + className : ''}`} onClick={onFocus}>
      <div className="panel-header">
        <span>{title}{focused ? ' \u25C0' : ''}</span>
        <span className="panel-hint">click to focus</span>
      </div>
      <div className="panel-content" ref={contentRef}>
        {lines.map((line, i) => {
          const clean = stripAnsi(line);
          return (
            <div key={i} className={`log-line ${getLineClass(clean)}`}>
              {clean}
            </div>
          );
        })}
      </div>
    </div>
  );
}
