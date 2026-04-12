import React, { useState } from 'react';
import { LogPanel } from '../components/LogPanel';
import './DevSpace.css';

interface DevSpaceProps {
  serviceLines: string[];
  metroLines: string[];
  instanceId: string;
}

export function DevSpace({ serviceLines, metroLines, instanceId }: DevSpaceProps) {
  const [focusedPanel, setFocusedPanel] = useState<'tool' | 'metro'>('tool');

  return (
    <div className="dev-space">
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
  );
}
