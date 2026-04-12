import { useEffect, useCallback } from 'react';

/**
 * Subscribe to an IPC channel from the main process.
 * Falls back to no-op when running outside Electron (plain browser).
 */
export function useIpcOn(channel: string, handler: (...args: any[]) => void) {
  useEffect(() => {
    if (!window.rndev) return;
    window.rndev.on(channel, handler);
    return () => {
      window.rndev?.off(channel, handler);
    };
  }, [channel, handler]);
}

/**
 * Returns an invoke function for sending commands to main process.
 * Falls back to a resolved promise when outside Electron.
 */
export function useIpcInvoke() {
  return useCallback((channel: string, ...args: any[]) => {
    if (!window.rndev) {
      console.log(`[ipc-stub] invoke: ${channel}`, ...args);
      return Promise.resolve({ ok: true });
    }
    return window.rndev.invoke(channel, ...args);
  }, []);
}
