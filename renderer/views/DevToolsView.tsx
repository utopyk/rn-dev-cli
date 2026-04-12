import React, { useState, useEffect, useRef } from 'react';
import { useIpcInvoke } from '../hooks/useIpc';
import './DevToolsView.css';

interface DevToolsViewProps {
  metroPort: number;
}

type ConnectionState = 'connecting' | 'no-target' | 'connected' | 'error';

export function DevToolsView({ metroPort }: DevToolsViewProps) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [devtoolsUrl, setDevtoolsUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const invoke = useIpcInvoke();

  useEffect(() => {
    let cancelled = false;

    async function pollForTargets() {
      try {
        // Use IPC to fetch from main process (avoids CORS restrictions in renderer)
        const targets = await invoke('devtools:getTargets', metroPort);
        if (!targets) {
          setState('error');
          setErrorMsg(`Cannot connect to Metro on port ${metroPort}`);
          return;
        }

        if (cancelled) return;

        if (Array.isArray(targets) && targets.length > 0) {
          // Found a target — extract the devtools frontend URL
          const target = targets[0];
          let url: string;

          if (target.devtoolsFrontendUrl) {
            // Metro provides the frontend URL — just prefix with host
            url = `http://localhost:${metroPort}${target.devtoolsFrontendUrl}`;
          } else if (target.webSocketDebuggerUrl) {
            // Fallback: construct the URL manually
            const wsPath = target.webSocketDebuggerUrl.replace(`ws://localhost:${metroPort}`, '');
            url = `http://localhost:${metroPort}/debugger-frontend/rn_fusebox.html?ws=${encodeURIComponent(wsPath)}&sources.hide_add_folder=true`;
          } else {
            setState('no-target');
            return;
          }

          setDevtoolsUrl(url);
          setState('connected');

          // Stop polling
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        } else {
          setState('no-target');
        }
      } catch (err) {
        if (!cancelled) {
          setState('error');
          setErrorMsg(`Cannot connect to Metro on port ${metroPort}`);
        }
      }
    }

    // Poll every 2 seconds until we find a target
    pollForTargets();
    pollingRef.current = setInterval(pollForTargets, 2000);

    return () => {
      cancelled = true;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [metroPort]);

  if (state === 'connecting') {
    return (
      <div className="devtools-placeholder">
        <div className="devtools-icon">🔧</div>
        <div className="devtools-title">Connecting to Metro DevTools...</div>
        <div className="devtools-subtitle">Looking for debugger targets on port {metroPort}</div>
      </div>
    );
  }

  if (state === 'no-target') {
    return (
      <div className="devtools-placeholder">
        <div className="devtools-icon">📱</div>
        <div className="devtools-title">Waiting for app to connect</div>
        <div className="devtools-subtitle">
          Metro is running on port {metroPort} but no app is connected yet.
          <br />Launch the app on a device or simulator to see DevTools.
        </div>
        <div className="devtools-hint">
          The app will be detected automatically once it connects to Metro.
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="devtools-placeholder">
        <div className="devtools-icon">⚠</div>
        <div className="devtools-title">DevTools unavailable</div>
        <div className="devtools-subtitle">{errorMsg}</div>
        <div className="devtools-hint">Make sure Metro is running on port {metroPort}.</div>
      </div>
    );
  }

  // Connected — render the DevTools frontend in a webview
  return (
    <div className="devtools-container">
      <div className="devtools-toolbar">
        <span className="devtools-toolbar-title">React Native DevTools</span>
        <span className="devtools-toolbar-port">:{metroPort}</span>
        <button
          className="devtools-toolbar-btn"
          onClick={() => {
            setState('connecting');
            setDevtoolsUrl(null);
          }}
        >
          ↻ Reconnect
        </button>
        <button
          className="devtools-toolbar-btn"
          onClick={() => {
            if (devtoolsUrl) window.open(devtoolsUrl, '_blank');
          }}
        >
          ↗ Pop Out
        </button>
      </div>
      <webview
        src={devtoolsUrl!}
        className="devtools-webview"
        // @ts-ignore — webview is an Electron-specific element
        allowpopups="true"
      />
    </div>
  );
}
