const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onGhost: callback => ipcRenderer.on('ghost', (_event, symbols, html) => callback(symbols, html)),
  onCursor: callback => ipcRenderer.on('cursor', (_event, x, y) => callback(x, y)),
  onLand: callback => ipcRenderer.on('land', () => callback())
});
