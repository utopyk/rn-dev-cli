import React, { useState, useMemo } from 'react';
import type { LogSection } from '../types';
import { CollapsibleLog } from '../components/CollapsibleLog';
import { ErrorSummary, extractErrors } from '../components/ErrorSummary';
import { LogPanel } from '../components/LogPanel';
import './DevSpace.css';

interface DevSpaceProps {
  serviceLines: string[];
  metroLines: string[];
  sections: LogSection[];
  instanceId: string;
  onToggleSection?: (sectionId: string) => void;
}

export function DevSpace({ serviceLines, metroLines, sections, instanceId, onToggleSection }: DevSpaceProps) {
  const [focusedPanel, setFocusedPanel] = useState<'tool' | 'metro'>('tool');

  // Extract build errors from service lines (only when there are errors)
  const buildErrors = useMemo(() => {
    // Only show error summary if there's a section with error status,
    // or if flat lines contain error indicators
    const hasErrorSection = sections.some(s => s.status === 'error');
    const hasErrorLines = serviceLines.some(l =>
      l.includes('Build failed') || l.includes('error:') || l.includes('not found')
    );

    if (!hasErrorSection && !hasErrorLines) return [];
    return extractErrors(serviceLines);
  }, [serviceLines, sections]);

  return (
    <div className="dev-space">
      <ErrorSummary errors={buildErrors} />
      <CollapsibleLog
        sections={sections}
        flatLines={serviceLines}
        focused={focusedPanel === 'tool'}
        onFocus={() => setFocusedPanel('tool')}
        onToggleSection={onToggleSection}
      />
      <LogPanel
        title="Metro Output"
        lines={metroLines}
        focused={focusedPanel === 'metro'}
        onFocus={() => setFocusedPanel('metro')}
      />
    </div>
  );
}
