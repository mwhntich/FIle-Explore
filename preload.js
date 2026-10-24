const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('slate', {
  home: () => ipcRenderer.invoke('home'),
  drives: () => ipcRenderer.invoke('drives'),
  list: folder => ipcRenderer.invoke('list', folder),
  open: file => ipcRenderer.invoke('open', file),
  transfer: (paths, destination, move) => ipcRenderer.invoke('transfer', paths, destination, move),
  mkdir: (parent, name) => ipcRenderer.invoke('mkdir', parent, name),
  rename: (source, name) => ipcRenderer.invoke('rename', source, name),
  trash: paths => ipcRenderer.invoke('trash', paths),
  remove: paths => ipcRenderer.invoke('remove', paths),
  startDrag: (paths, image) => ipcRenderer.invoke('start-drag', paths, image),
  onNav: callback => ipcRenderer.on('nav', (_event, direction) => callback(direction)),
  window: action => ipcRenderer.invoke('window', action),
  pathForFile: file => webUtils.getPathForFile(file)
});
