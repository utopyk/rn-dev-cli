import React, { useState, useEffect, useRef } from 'react';
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
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Outside-click + Escape dismisses the confirm. Replaces the prior
  // 3-second wall-clock auto-dismiss that was firing before users
  // could complete the two-click confirm in slower flows (reading
  // the chip text, mouse repositioning) — see the 2026-05-06 user
  // report where the second click hit a re-set state and re-armed
  // instead of confirming, leaving the tab open. No timer here on
  // purpose: the previous fix tried 15s as a "safety net" but that
  // recreates the same race for any user slower than the timeout.
  // Outside click + Esc cover every legitimate cancellation; if the
  // user truly walks away with the confirm armed, the next click
  // anywhere drops it.
  useEffect(() => {
    if (!confirmClose) return;
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      const root = containerRef.current;
      if (!root || !target || !root.contains(target)) {
        setConfirmClose(null);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setConfirmClose(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [confirmClose]);

  const handleClose = (e: React.MouseEvent, id: string, _port: number) => {
    e.stopPropagation();
    // Shift-click: skip confirmation. Documented in the close button's
    // `title` attribute so power users can discover it on hover.
    if (e.shiftKey) {
      onClose(id);
      setConfirmClose(null);
      return;
    }
    if (confirmClose === id) {
      // Second click = confirmed
      onClose(id);
      setConfirmClose(null);
    } else {
      setConfirmClose(id);
    }
  };

  return (
    <div className="instance-tabs" ref={containerRef}>
      <div className="instance-tabs-scroll">
        {instances.map((inst) => {
          const isActive = inst.id === activeId;
          const isConfirming = confirmClose === inst.id;
          return (
            <div
              key={inst.id}
              className={`instance-tab${isActive ? ' active' : ''}${isConfirming ? ' confirming' : ''}`}
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
                aria-label={isConfirming ? `Click again to close instance on port ${inst.port}` : 'Close instance'}
                title={isConfirming
                  ? `Click again to close (Shift-click to skip confirm)`
                  : 'Close instance (Shift-click to skip confirm)'}
              >
                {isConfirming ? '\u2713' : '\u00d7'}
              </button>
              {isConfirming && (
                <div className="instance-tab-confirm" role="status">
                  Click again to close :{inst.port}
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
