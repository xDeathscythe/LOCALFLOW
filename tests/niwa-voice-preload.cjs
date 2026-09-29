const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('voiceTest', { start: sdp => ipcRenderer.invoke('voice-test-start', sdp), onSdp: callback => ipcRenderer.on('sdp', (_event, sdp) => callback(sdp)) });
