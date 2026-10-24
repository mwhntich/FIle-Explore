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
  window: action => ipcRenderer.invoke('window', action),
  pathForFile: file => webUtils.getPathForFile(file)
});
