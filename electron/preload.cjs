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
  notesList: () => ipcRenderer.invoke('notes-list'),
  notesRead: id => ipcRenderer.invoke('notes-read', id),
  notesCreate: value => ipcRenderer.invoke('notes-create', value),
  notesSave: value => ipcRenderer.invoke('notes-save', value),
  notesRemove: id => ipcRenderer.invoke('notes-remove', id),
  notesImport: items => ipcRenderer.invoke('notes-importLegacy', items),
  notesRename: value => ipcRenderer.invoke('notes-rename', value),
  notesMove: value => ipcRenderer.invoke('notes-move', value),
  notesDatabaseRead: id => ipcRenderer.invoke('notes-databaseRead', id),
  notesDatabaseSave: value => ipcRenderer.invoke('notes-databaseSave', value),
  notesDatabaseRunButton: value => ipcRenderer.invoke('notes-databaseRunButton', value),
  notesDatabaseAddRow: value => ipcRenderer.invoke('notes-databaseAddRow', value),
  notesImportNotion: () => ipcRenderer.invoke('notes-import-notion'),
  notesOpenAsset: url => ipcRenderer.invoke('notes-open-asset', url),
  notesPickAssets: () => ipcRenderer.invoke('notes-pick-assets'),
  notesUploadAssets: files => ipcRenderer.invoke('notes-upload-assets', files),
  notesExportPdf: value => ipcRenderer.invoke('notes-export-pdf', value),
  notesDuplicate: value => ipcRenderer.invoke('notes-duplicate', value),
  notesDatabaseMoveRow: value => ipcRenderer.invoke('notes-databaseMoveRow', value),
  niwaProjects: () => ipcRenderer.invoke('niwa-projects'),
  niwaAddProject: () => ipcRenderer.invoke('niwa-add-project'),
  niwaManageProject: value => ipcRenderer.invoke('niwa-manage-project', value),
  niwaOpenFolder: id => ipcRenderer.invoke('niwa-open-folder', id),
  niwaNewChat: id => ipcRenderer.invoke('niwa-new-chat', id),
  niwaSelectChat: id => ipcRenderer.invoke('niwa-select-chat', id),
  niwaRenameChat: value => ipcRenderer.invoke('niwa-rename-chat', value),
  niwaSelectFiles: () => ipcRenderer.invoke('niwa-select-files'),
  niwaUndoChanges: diff => ipcRenderer.invoke('niwa-undo-changes', diff),
  niwaSnapshot: () => ipcRenderer.invoke('niwa-snapshot'),
  niwaConnect: () => ipcRenderer.invoke('niwa-connect'),
  niwaConnectBrowser: () => ipcRenderer.invoke('niwa-connect-browser'),
  niwaDisconnectBrowser: () => ipcRenderer.invoke('niwa-disconnect-browser'),
  niwaSend: text => ipcRenderer.invoke('niwa-send', text),
  notesSkill: value => ipcRenderer.invoke('notes-skill', value),
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
