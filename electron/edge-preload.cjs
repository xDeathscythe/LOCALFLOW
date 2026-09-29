const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('edge', {
  hover: value => ipcRenderer.send('edge-hover', value),
  action: value => ipcRenderer.send('edge-action', value),
  onState: callback => ipcRenderer.on('edge-state', (_event, state) => callback(state)),
});
