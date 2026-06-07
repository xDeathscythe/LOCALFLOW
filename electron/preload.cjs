const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localflow", {
  selectAudioFile: () => ipcRenderer.invoke("select-audio-file"),
  saveAudioBuffer: (payload) => ipcRenderer.invoke("save-audio-buffer", payload),
  transcribeFile: (payload) => ipcRenderer.invoke("transcribe-file", payload),
  setWhisperModel: (model) => ipcRenderer.invoke("set-whisper-model", model),
  exportText: (payload) => ipcRenderer.invoke("export-text", payload),
  openPath: (filePath) => ipcRenderer.invoke("open-path", filePath),
  pasteText: (text) => ipcRenderer.invoke("paste-text", text),
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
});
