// Host-renderer preload. Exposes a narrow `window.rndev` surface with an
// explicit channel allowlist — NOT a generic `invoke(anyChannel)` bridge.
//
// Security F5 (Phase 5c) — before this existed, the preload forwarded every
// channel to `ipcMain.handle` / `ipcMain.on`. A bug anywhere else in the
// renderer (XSS in a module panel? third-party React dep running a postMessage
// handler?) that reaches `window.rndev.invoke` could hit ANY ipcMain handle,
// including ones we haven't hardened. The allowlist forces us to re-decide
// explicitly each time a new channel is wired up, and the reject path is loud
// (console.error for on/off, rejected promise for invoke) so regressions
// surface during development.
//
// The allowlist arrays live in `preload-allowlist.js` so vitest can cover the
// predicate without pulling in the `electron` runtime.

const { contextBridge, ipcRenderer } = require('electron');
const { isAllowedInvoke, isAllowedOn } = require('./preload-allowlist.cjs');

contextBridge.exposeInMainWorld('rndev', {
  on: (channel, callback) => {
    if (!isAllowedOn(channel)) {
      console.error(`[preload] rejected on("${channel}") — not in allowlist`);
      return;
    }
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  off: (channel) => {
    if (!isAllowedOn(channel)) {
      console.error(`[preload] rejected off("${channel}") — not in allowlist`);
      return;
    }
    ipcRenderer.removeAllListeners(channel);
  },
  invoke: (channel, ...args) => {
    if (!isAllowedInvoke(channel)) {
      return Promise.reject(
        new Error(`[preload] rejected invoke("${channel}") — not in allowlist`),
      );
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
