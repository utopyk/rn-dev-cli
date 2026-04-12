import React, { useState } from 'react';
import './InstanceTabs.css';

export interface InstanceInfo {
  id: string;
  worktreeName: string;
  branch: string;
  port: number;
  deviceName: string;
  deviceIcon: string;
  platform: string;
  metroStatus: string;
}

interface InstanceTabsProps {
  instances: InstanceInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;  // Opens the new-instance dialog
}

function shortenName(name: string, max: number): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '\u2026';
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'running': return 'instance-dot running';
    case 'starting': return 'instance-dot starting';
    case 'error': return 'instance-dot error';
    default: return 'instance-dot stopped';
  }
}

export function InstanceTabs({ instances, activeId, onSelect, onClose, onAdd }: InstanceTabsProps) {
  const [confirmClose, setConfirmClose] = useState<string | null>(null);

  const handleClose = (e: React.MouseEvent, id: string, port: number) => {
    e.stopPropagation();
    if (confirmClose === id) {
      // Second click = confirmed
      onClose(id);
      setConfirmClose(null);
    } else {
      setConfirmClose(id);
      // Auto-dismiss confirmation after 3 seconds
      setTimeout(() => setConfirmClose((prev) => (prev === id ? null : prev)), 3000);
    }
  };

  return (
    <div className="instance-tabs">
      <div className="instance-tabs-scroll">
        {instances.map((inst) => {
          const isActive = inst.id === activeId;
          const isConfirming = confirmClose === inst.id;
          return (
            <div
              key={inst.id}
              className={`instance-tab${isActive ? ' active' : ''}`}
              onClick={() => onSelect(inst.id)}
            >
              <span className="instance-tab-icon">{inst.deviceIcon}</span>
              <span className="instance-tab-name">
                {shortenName(inst.worktreeName, 10)}:{inst.port}
              </span>
              <span className="instance-tab-device">
                {shortenName(inst.deviceName, 14)}
              </span>
              <span className={statusDotClass(inst.metroStatus)} />
              <button
                className={`instance-tab-close${isConfirming ? ' confirming' : ''}`}
                onClick={(e) => handleClose(e, inst.id, inst.port)}
                title={isConfirming ? `Stop Metro on :${inst.port}?` : 'Close instance'}
              >
                {isConfirming ? '?' : '\u00d7'}
              </button>
              {isConfirming && (
                <div className="instance-tab-confirm">
                  Stop Metro on :{inst.port}?
                </div>
              )}
            </div>
          );
        })}
        <button className="instance-tab-add" onClick={onAdd} title="New instance">
          +
        </button>
      </div>
    </div>
  );
}
