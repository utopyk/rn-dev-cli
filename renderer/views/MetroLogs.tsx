import React from 'react';
import { LogPanel } from '../components/LogPanel';

interface MetroLogsProps {
  lines: string[];
}

export function MetroLogs({ lines }: MetroLogsProps) {
  return (
    <div style={{ flex: 1, display: 'flex', padding: '4px 12px', minHeight: 0 }}>
      <LogPanel title="Metro Output (Full)" lines={lines} focused />
    </div>
  );
}
