const { contextBridge, ipcRenderer } = require("electron");
let browserState = { mode: 'bundled', connected: false };
let cleanupModel = 'gpt-5.6-terra';
let niwaVoice = 'juniper';
const voices = ['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove'];
const niwaSettings = () => ({ model: '', effort: 'medium', voiceMode: 'realtime', voice: niwaVoice, access: 'workspace', cwd: 'LocalFlow/workspace' });

let authListener = null;
const authStatus = {
  connected: true,
  mode: "codex",
  busy: false,
  stage: "connected",
  message: "Cleanup access is connected.",
  deviceCode: null,
  deviceUrl: null,
};

contextBridge.exposeInMainWorld("localflow", {
  getEdgeSettings: async () => ({ enabled: true, autoHide: true }),
  setEdgeSettings: async value => value,
  onEdgeAction: callback => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('test-edge-action', listener);
    return () => ipcRenderer.removeListener('test-edge-action', listener);
  },
  onNiwaEvent: callback => {
    const listener = (_event, event) => callback(event);
    ipcRenderer.on('test-niwa-event', listener);
    return () => ipcRenderer.removeListener('test-niwa-event', listener);
  },
  notesImport: items => process.argv.includes('--workspace-check') ? ipcRenderer.invoke('workspace-notes-importLegacy', items) : Promise.resolve({items, directory: ''}),
  notesList: () => ipcRenderer.invoke('workspace-notes-list'),
  notesTrash: value => ipcRenderer.invoke('workspace-notes-trash', value),
  notesRestore: value => ipcRenderer.invoke('workspace-notes-restore', value),
  notesHistory: value => ipcRenderer.invoke('workspace-notes-history', value),
  notesRestoreVersion: value => ipcRenderer.invoke('workspace-notes-restoreVersion', value),
  notesSkill: value => ipcRenderer.invoke('workspace-notes-skill', value),
  notesRead: id => ipcRenderer.invoke('workspace-notes-read', id),
  notesCreate: value => ipcRenderer.invoke('workspace-notes-create', value),
  notesSave: value => ipcRenderer.invoke('workspace-notes-save', value),
  notesRemove: id => ipcRenderer.invoke('workspace-notes-remove', id),
  notesRename: value => ipcRenderer.invoke('workspace-notes-rename', value),
  notesMove: value => ipcRenderer.invoke('workspace-notes-move', value),
  notesDatabaseRead: id => ipcRenderer.invoke('workspace-notes-databaseRead', id),
  notesDatabasePage: value => ipcRenderer.invoke('workspace-notes-databasePage', value),
  notesDatabasePatch: value => ipcRenderer.invoke('workspace-notes-databasePatch', value),
  notesDatabasePageAction: value => ipcRenderer.invoke('workspace-notes-databasePageAction', value),
  notesDatabaseOptions: id => ipcRenderer.invoke('workspace-notes-databaseOptions', id),
  notesDatabaseExport: value => ipcRenderer.invoke('workspace-notes-databaseExport', value),
  notesDatabaseSave: value => ipcRenderer.invoke('workspace-notes-databaseSave', value),
  notesDatabaseRunButton: value => ipcRenderer.invoke('workspace-notes-databaseRunButton', value),
  notesDatabaseAddRow: value => ipcRenderer.invoke('workspace-notes-databaseAddRow', value),
  notesImportNotion: () => Promise.resolve(null),
  notesOpenAsset: () => Promise.resolve(),
  notesPickAssets: () => ipcRenderer.invoke('workspace-notes-pick-assets'),
  notesUploadAssets: files => ipcRenderer.invoke('workspace-notes-upload-assets', files),
  notesExportPdf: value => ipcRenderer.invoke('workspace-notes-export-pdf', value),
  notesDuplicate: value => ipcRenderer.invoke('workspace-notes-duplicate',value),
  notesDatabaseMoveRow: value => ipcRenderer.invoke('workspace-notes-databaseMoveRow',value),
  niwaSelectFiles: async () => ['X:/Projects/日本語/readme.md'],
  niwaUndoChanges: diff => ipcRenderer.invoke('workspace-undo-changes', diff),
  niwaProjects: () => ipcRenderer.invoke('workspace-projects'),
  niwaAddProject: () => ipcRenderer.invoke('workspace-add-project'),
  niwaManageProject: value => ipcRenderer.invoke('workspace-manage-project', value),
  niwaOpenFolder: id => ipcRenderer.invoke('workspace-open-folder', id),
  niwaNewChat: id => ipcRenderer.invoke('workspace-new-chat', id),
  niwaSelectChat: id => ipcRenderer.invoke('workspace-select-chat', id),
  niwaRenameChat: value => ipcRenderer.invoke('workspace-rename-chat', value),
  niwaConnect: () => ipcRenderer.invoke('workspace-connect'),
  copyText: async text => { ipcRenderer.send('workspace-copy-text',text); },
  exportText: async () => null,
  niwaStartVoice: sdp => ipcRenderer.invoke('test-niwa-start', sdp),
  niwaStopVoice: () => ipcRenderer.invoke('test-niwa-stop'),
  niwaSend: async text => ipcRenderer.send('niwa-test-send', text),
  niwaSnapshot: async value => process.argv.includes('--workspace-check') ? ipcRenderer.invoke('workspace-snapshot', value) : ({ browser: browserState, settings: niwaSettings(), voices, messages: [], models: [], memory: { active_facts: 0, documents: {} }, connectors: [], busy: false, voice: false, approvals: [] }),
  niwaConfigure: async patch => { if (process.argv.includes('--workspace-check')) return ipcRenderer.invoke('workspace-configure', patch); if (patch.voice) niwaVoice = patch.voice; return niwaSettings(); },
  niwaConnectBrowser: async () => (browserState = {mode:'chrome',connected:true}),
  niwaDisconnectBrowser: async () => (browserState = {mode:'bundled',connected:false}),
  selectAudioFile: async () => "localflow-layout-check.wav",
  setWhisperLanguage: async language => ({ language, outputLanguage: language }),
  getAppearance: () => process.argv.includes("--appearance-check") ? ipcRenderer.invoke("get-appearance") : Promise.resolve("dark"),
  setAppearance: (theme) => ipcRenderer.invoke("set-appearance", theme),
  getVoiceOutputConfig: async () => ({ model: "piper", voiceRoot: "LocalFlow/tts", options: [] }),
  getHermesConfig: async () => ({ detected: false, source: "", sourceLabel: "Not connected", profiles: [], mainProfileId: "", primaryProfileIds: [] }),
  getShortcuts: async () => ({}),
  cancelTranscription: async () => {},
  setShortcutCapture: async () => {},
  onShortcutCaptured: () => () => {},
  getCleanupAuthStatus: async () => authStatus,
  getCleanupModels: async () => ({ selected: cleanupModel, error: '', models: [{ id: 'gpt-5.6-terra', label: 'Terra' }, { id: 'gpt-6-astra', label: 'Astra' }, { id: 'gpt-live-1-codex', label: 'Live 1 · realtime cleanup' }] }),
  setCleanupModel: async model => (cleanupModel = model),
  onCleanupAuthEvent: (callback) => { authListener = callback; return () => { authListener = null; }; },
  connectCleanupWithCodex: async () => {
    const pending = {
      connected: false,
      mode: null,
      busy: true,
      stage: "device-code",
      message: "Enter the code in the opened Codex authorization window.",
      deviceCode: "ABCD-EFGH9",
      deviceUrl: "https://auth.openai.com/codex/device",
    };
    authListener?.(pending);
    return pending;
  },
  connectCleanupWithApiKey: async () => authStatus,
  disconnectCleanup: async () => authStatus,
  cancelCleanupConnection: async () => authStatus,
  openCleanupAuthBrowser: async () => authStatus,
  onWorkerProgress: () => () => {},
  onDictationHotkey: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("test-hotkey", listener);
    return () => ipcRenderer.removeListener("test-hotkey", listener);
  },
  onRecordingOverlayStop: () => () => {},
  setRecordingOverlayState: (state) => ipcRenderer.send("test-recording-state", state),
  onWindowVisibility: (callback) => {
    const listener = (_event, visible) => callback(visible);
    ipcRenderer.on("test-visibility", listener);
    return () => ipcRenderer.removeListener("test-visibility", listener);
  },
  saveAudioBuffer: (payload) => ipcRenderer.invoke("test-save-audio", payload),
  pasteText: text => ipcRenderer.invoke('test-paste', text),
  transcribeFile: () => process.argv.includes('--niwa-dictation-check') ? ipcRenderer.invoke('test-transcribe') : Promise.resolve(process.argv.includes("--appearance-check")
    ? { rawText: "Keep the interface quiet. The words should have the most space, and everything I need should be one click away.\n\nI want to speak, collect a thought, and get back to what I was doing.", polishedText: "Keep the interface quiet. Give the words the most space, and keep everything I need one click away.\n\nSpeak, capture a thought, and return to what you were doing.", duration: 28 }
    : { rawText: "", polishedText: "", duration: 1 }),
});
