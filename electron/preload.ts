const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rndev', {
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event: any, ...args: any[]) => callback(...args));
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeAllListeners(channel);
  },
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
});
