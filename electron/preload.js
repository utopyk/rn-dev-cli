const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rndev', {
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  off: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
