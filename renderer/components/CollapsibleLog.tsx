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
  onRetrySection?: (sectionId: string) => void;
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
    case 'ok': return 'status-ok';
    case 'warning': return 'status-warning';
    case 'error': return 'status-error';
    case 'running': return 'status-running';
  }
}

interface AccordionSectionProps {
  section: LogSection;
  onToggle: () => void;
  onRetry?: () => void;
}

function AccordionSection({ section, onToggle, onRetry }: AccordionSectionProps) {
  const chevron = section.collapsed ? '\u25B6' : '\u25BC';
  const icon = section.status === 'running' ? section.icon : statusIcon(section.status);
  const isRunning = section.status === 'running';
  const sc = statusClass(section.status);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRetry?.();
  }, [onRetry]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  }, [onToggle]);

  return (
    <div className={`accordion-section ${sc}`}>
      {/* Header row */}
      <div
        className="accordion-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-expanded={!section.collapsed}
      >
        <span className="accordion-chevron">{chevron}</span>
        <span className={`accordion-status-icon ${sc} ${isRunning ? 'icon-pulse' : ''}`}>
          {icon}
        </span>
        <span className="accordion-title">{section.title}</span>
        <span className="accordion-count">({section.lines.length} lines)</span>
        {!isRunning && onRetry && (
          <button
            className="accordion-retry"
            onClick={handleRetry}
            title={`Retry ${section.title}`}
          >
            &#x21BB; Retry
          </button>
        )}
        {isRunning && (
          <span className="accordion-running-badge">running</span>
        )}
      </div>

      {/* Body (expanded) */}
      {!section.collapsed && (
        <div className="accordion-body">
          {section.lines.map((line, i) => {
            const clean = stripAnsi(line);
            return (
              <div key={i} className={`log-line ${getLineClass(clean)}`}>
                {clean}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CollapsibleLog({ sections, flatLines, focused = false, onFocus, onToggleSection, onRetrySection }: CollapsibleLogProps) {
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

  const handleRetry = useCallback((sectionId: string) => {
    onRetrySection?.(sectionId);
  }, [onRetrySection]);

  return (
    <div className={`panel${focused ? ' focused' : ''}`} onClick={onFocus}>
      <div className="panel-header">
        <span>Tool Output{focused ? ' \u25C0' : ''}</span>
        <span className="panel-hint">click to focus</span>
      </div>
      <div className="panel-content collapsible-log-content" ref={contentRef}>
        {hasSections ? (
          <div className="accordion-list">
            {sections.map((section) => (
              <AccordionSection
                key={section.id}
                section={section}
                onToggle={() => handleToggle(section.id)}
                onRetry={onRetrySection ? () => handleRetry(section.id) : undefined}
              />
            ))}
          </div>
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
