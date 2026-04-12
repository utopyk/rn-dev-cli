import React, { useRef, useEffect, useCallback } from 'react';
import type { LogSection } from '../types';
import './CollapsibleLog.css';

interface CollapsibleLogProps {
  sections: LogSection[];
  /** Flat lines fallback when no sections exist */
  flatLines: string[];
  focused?: boolean;
  onFocus?: () => void;
  onToggleSection?: (sectionId: string) => void;
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
  return 'log-default';
}

function statusIcon(status: LogSection['status']): string {
  switch (status) {
    case 'ok': return '\u2714';
    case 'warning': return '\u26A0';
    case 'error': return '\u2716';
    case 'running': return '\u23F3';
  }
}

function statusClass(status: LogSection['status']): string {
  switch (status) {
    case 'ok': return 'section-status-ok';
    case 'warning': return 'section-status-warning';
    case 'error': return 'section-status-error';
    case 'running': return 'section-status-running';
  }
}

function SectionHeader({ section, onToggle }: { section: LogSection; onToggle: () => void }) {
  const chevron = section.collapsed ? '\u25B6' : '\u25BC';
  const icon = section.status === 'running' ? section.icon : statusIcon(section.status);

  return (
    <div
      className={`section-header ${statusClass(section.status)}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
    >
      <span className="section-chevron">{chevron}</span>
      <span className={`section-icon ${section.status === 'running' ? 'icon-spin' : ''}`}>{icon}</span>
      <span className="section-title">{section.title}</span>
      <span className="section-line-count">({section.lines.length} lines)</span>
    </div>
  );
}

function SectionBody({ section }: { section: LogSection }) {
  if (section.collapsed) return null;

  return (
    <div className="section-body">
      {section.lines.map((line, i) => {
        const clean = stripAnsi(line);
        return (
          <div key={i} className={`log-line ${getLineClass(clean)}`}>
            {clean}
          </div>
        );
      })}
    </div>
  );
}

export function CollapsibleLog({ sections, flatLines, focused = false, onFocus, onToggleSection }: CollapsibleLogProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const hasSections = sections.length > 0;

  // Total line count for auto-scroll detection
  const totalLines = hasSections
    ? sections.reduce((sum, s) => sum + s.lines.length, 0)
    : flatLines.length;

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [totalLines]);

  const handleToggle = useCallback((sectionId: string) => {
    onToggleSection?.(sectionId);
  }, [onToggleSection]);

  return (
    <div className={`panel${focused ? ' focused' : ''}`} onClick={onFocus}>
      <div className="panel-header">
        <span>Tool Output{focused ? ' \u25C0' : ''}</span>
        <span className="panel-hint">click to focus</span>
      </div>
      <div className="panel-content collapsible-log-content" ref={contentRef}>
        {hasSections ? (
          sections.map((section) => (
            <div key={section.id} className="log-section">
              <SectionHeader
                section={section}
                onToggle={() => handleToggle(section.id)}
              />
              <SectionBody section={section} />
            </div>
          ))
        ) : (
          flatLines.map((line, i) => {
            const clean = stripAnsi(line);
            return (
              <div key={i} className={`log-line ${getLineClass(clean)}`}>
                {clean}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
