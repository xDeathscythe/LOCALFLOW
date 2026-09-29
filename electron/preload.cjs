const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localflow", {
  getAppearance: () => ipcRenderer.invoke("get-appearance"),
  setAppearance: (theme) => ipcRenderer.invoke("set-appearance", theme),
  selectAudioFile: () => ipcRenderer.invoke("select-audio-file"),
  saveAudioBuffer: (payload) => ipcRenderer.invoke("save-audio-buffer", payload),
  transcribeFile: async (payload) => {
    const result = await ipcRenderer.invoke("transcribe-file", payload);
    if (!result?.ok) throw new Error(result?.error || "Local transcription failed");
    return result.data;
  },
  cancelTranscription: () => ipcRenderer.invoke("cancel-transcription"),
  setWhisperModel: (model) => ipcRenderer.invoke("set-whisper-model", model),
  setWhisperLanguage: (language) => ipcRenderer.invoke("set-whisper-language", language),
  getCleanupAuthStatus: () => ipcRenderer.invoke("cleanup-auth-status"),
  getCleanupModels: () => ipcRenderer.invoke('get-cleanup-models'),
  setCleanupModel: model => ipcRenderer.invoke('set-cleanup-model', model),
  connectCleanupWithCodex: () => ipcRenderer.invoke("cleanup-auth-connect-codex"),
  connectCleanupWithApiKey: (apiKey) => ipcRenderer.invoke("cleanup-auth-connect-api-key", apiKey),
  disconnectCleanup: () => ipcRenderer.invoke("cleanup-auth-disconnect"),
  cancelCleanupConnection: () => ipcRenderer.invoke("cleanup-auth-cancel"),
  openCleanupAuthBrowser: () => ipcRenderer.invoke("cleanup-auth-open-browser"),
  getVoiceOutputConfig: () => ipcRenderer.invoke("get-voice-output-config"),
  setVoiceOutputModel: (model) => ipcRenderer.invoke("set-voice-output-model", model),
  exportText: (payload) => ipcRenderer.invoke("export-text", payload),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  getShortcuts: () => ipcRenderer.invoke("get-shortcuts"),
  setShortcutCapture: (active) => ipcRenderer.invoke("set-shortcut-capture", active),
  onShortcutCaptured: (callback) => {
    const listener = (_event, binding) => callback(binding);
    ipcRenderer.on("shortcut-captured", listener);
    return () => ipcRenderer.removeListener("shortcut-captured", listener);
  },
  setShortcut: (payload) => ipcRenderer.invoke("set-shortcut", payload),
  openPath: (filePath) => ipcRenderer.invoke("open-path", filePath),
  pasteText: (text) => ipcRenderer.invoke("paste-text", text),
  getEdgeSettings: () => ipcRenderer.invoke('get-edge-settings'),
  setEdgeSettings: value => ipcRenderer.invoke('set-edge-settings', value),
  onEdgeAction: callback => { const listener = (_event, action) => callback(action); ipcRenderer.on('edge-action', listener); return () => ipcRenderer.removeListener('edge-action', listener); },
  niwaSnapshot: () => ipcRenderer.invoke('niwa-snapshot'),
  niwaConnect: () => ipcRenderer.invoke('niwa-connect'),
  niwaConnectBrowser: () => ipcRenderer.invoke('niwa-connect-browser'),
  niwaDisconnectBrowser: () => ipcRenderer.invoke('niwa-disconnect-browser'),
  niwaSend: text => ipcRenderer.invoke('niwa-send', text),
  niwaStartVoice: sdp => ipcRenderer.invoke('niwa-start-voice', sdp),
  niwaStopVoice: () => ipcRenderer.invoke('niwa-stop-voice'),
  niwaInterrupt: () => ipcRenderer.invoke('niwa-interrupt'),
  niwaConfigure: patch => ipcRenderer.invoke('niwa-configure', patch),
  niwaSaveConnector: config => ipcRenderer.invoke('niwa-save-connector', config),
  niwaForget: id => ipcRenderer.invoke('niwa-forget', id),
  niwaRespond: (id, answer) => ipcRenderer.invoke('niwa-respond', id, answer),
  onNiwaEvent: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('niwa-event', listener); return () => ipcRenderer.removeListener('niwa-event', listener); },
  setRecordingOverlayState: (payload) => ipcRenderer.send("recording-overlay-state", payload),
  onWindowVisibility: (callback) => {
    const listener = (_event, visible) => callback(visible);
    ipcRenderer.on("window-visibility", listener);
    return () => ipcRenderer.removeListener("window-visibility", listener);
  },
  onRecordingOverlayStop: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("recording-overlay-stop", listener);
    return () => ipcRenderer.removeListener("recording-overlay-stop", listener);
  },
  onDictationHotkey: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("dictation-hotkey", listener);
    return () => ipcRenderer.removeListener("dictation-hotkey", listener);
  },
  onWorkerProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("worker-progress", listener);
    return () => ipcRenderer.removeListener("worker-progress", listener);
  },
  onCleanupAuthEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("cleanup-auth-event", listener);
    return () => ipcRenderer.removeListener("cleanup-auth-event", listener);
  },
});
