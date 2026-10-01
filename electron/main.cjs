const { app, BrowserWindow, Menu, Tray, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } = require("electron");
const { captureScreen } = require('./screen-capture.cjs');
const { createDuplexCleanup } = require('./duplex-cleanup.cjs');
const { LIVE_MODEL } = require('./realtime-config.cjs');
const { themes, readAppearance, saveAppearance, windowAppearance, applyAppearance } = require("./appearance.cjs");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createCleanupAuthManager } = require("./cleanup-auth.cjs");
const { bundledConnectors } = require('./bundled-connectors.cjs');
const { connectChrome } = require('./chrome-connection.cjs');
const { createEdgePanel } = require('./edge-panel.cjs');
const registerNoteAssets = require('./notes/assets.cjs');
const { ensureShortcuts, readShortcuts, saveShortcut } = require("./shortcuts.cjs");
const { ensureTtsRuntime, resolveTtsRoot } = require("./tts-runtime.cjs");
const { createTranscriptionWorker } = require("./transcription-worker.cjs");
const { createPasteHandler } = require("./paste-text.cjs");
const { appRoot, resourcesRoot, loadDotEnv, persistDotEnvValue, ensureRuntimeEnv, resolvePython, resolveCodexBinary, resolveNiwaCodexBinary, BUNDLED_WHISPER_MODELS } = require("./runtime-config.cjs");
const { terminateProcess } = require("./child-process.cjs");
const {
  ALLOWED_VOICE_OUTPUT_MODELS,
  createVoiceOutputManager,
} = require("./voice-output.cjs");

for (const stream of [process.stdout, process.stderr]) {
  stream?.on("error", (error) => {
    if (error.code !== "EPIPE") throw error;
  });
}

let mainWindow = null;
let appearanceTheme = "dark";
let cleanupAuthManager = null;
let recordingOverlayProcess = null;
let tray = null;
let transcriptionWorker = null;
let duplexCleanup = null;
let hotkeyWatcher = null;
let shortcutCaptureActive = false;
let voiceOutputManager = null;
let edgePanel = null;
let niwaAgent = null;
let niwaReady = null;
let isQuitting = false;
const ONNX_STT_MODELS = new Set([
  "nemo-parakeet-tdt-0.6b-v3",
  "nemo-canary-1b-v2",
]);
const ALLOWED_WHISPER_MODELS = new Set([...BUNDLED_WHISPER_MODELS, ...ONNX_STT_MODELS]);
const ALLOWED_WHISPER_LANGUAGES = new Set(["sr", "en", "auto"]);
const WHISPER_OUTPUT_LANGUAGES = Object.freeze({ sr: "Serbian Latin", en: "English", auto: "Original language" });
const RECORDING_OVERLAY_SIZE = Object.freeze({ width: 144, height: 42 });
const RECORDING_OVERLAY_BOTTOM_GAP = 18;
let recordingOverlayState = { recording: false, starting: false, agentListening: false, recordingTarget: 'microphone', elapsedSeconds: 0 };

function localFlowAssetPath(filename) {
  return path.join(resourcesRoot(), "assets", filename);
}

function workerScriptPath() {
  const root = appRoot();
  const packaged = path.join(resourcesRoot(), "backend", "worker.py");
  if (app.isPackaged && fs.existsSync(packaged)) {
    return packaged;
  }
  return path.join(root, "backend", "worker.py");
}

function hotkeyWatcherScriptPath() {
  return path.join(resourcesRoot(), "backend", "hotkey_watcher.py");
}

function recordingOverlayScriptPath() {
  return path.join(resourcesRoot(), "backend", "recording_overlay.py");
}

function createTrayImage() {
  for (const filename of ["localflow-logo-32.png", "localflow-logo-512.png"]) {
    const image = nativeImage.createFromPath(localFlowAssetPath(filename));
    if (!image.isEmpty()) {
      return image.resize({ width: 32, height: 32, quality: "best" });
    }
  }
  return nativeImage.createEmpty();
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  syncRecordingOverlayWindow();
}

function createTray() {
  if (tray) {
    return;
  }
  tray = new Tray(createTrayImage());
  tray.setToolTip("LocalFlow");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show LocalFlow", click: showMainWindow },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", showMainWindow);
}

function recordingOverlayDisplay() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return screen.getDisplayMatching(mainWindow.getBounds());
  }
  return screen.getPrimaryDisplay();
}

function recordingOverlayPlacement() {
  const { workArea } = recordingOverlayDisplay();
  return {
    x: workArea.x + Math.round((workArea.width - RECORDING_OVERLAY_SIZE.width) / 2),
    y: workArea.y + workArea.height - RECORDING_OVERLAY_SIZE.height - RECORDING_OVERLAY_BOTTOM_GAP,
  };
}

function startRecordingOverlay() {
  if (recordingOverlayProcess && !recordingOverlayProcess.killed) {
    return recordingOverlayProcess;
  }

  const python = resolvePython();
  const overlay = spawn(python.command, [...python.args, recordingOverlayScriptPath()], {
    cwd: resourcesRoot(),
    env: process.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  recordingOverlayProcess = overlay;

  let buffer = "";
  overlay.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          if (message?.type === "stop") {
            mainWindow?.webContents.send("recording-overlay-stop");
          }
        } catch {
          // Ignore malformed helper output.
        }
      }
      index = buffer.indexOf("\n");
    }
  });
  overlay.stderr.on("data", (chunk) => {
    mainWindow?.webContents.send("worker-progress", {
      type: "stderr",
      message: `[recording-overlay] ${chunk.toString("utf8").trim()}`,
    });
  });
  overlay.stdin.on("error", () => {});
  overlay.on("exit", () => {
    if (recordingOverlayProcess === overlay) {
      recordingOverlayProcess = null;
    }
  });
  return overlay;
}

function sendRecordingOverlayState(visible) {
  const overlay = startRecordingOverlay();
  if (!overlay.stdin.writable) {
    return;
  }
  overlay.stdin.write(`${JSON.stringify({
    visible,
    starting: recordingOverlayState.starting,
    elapsedSeconds: recordingOverlayState.elapsedSeconds,
    ...recordingOverlayPlacement(),
  })}\n`, () => {});
}

function syncRecordingOverlayWindow() {
  const mainWindowUnavailable = !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized();
  mainWindow?.webContents.send("window-visibility", !mainWindowUnavailable);
  edgePanel?.update({ ...recordingOverlayState, theme: appearanceTheme });
  const showLegacy = !edgePanel?.get().enabled && (recordingOverlayState.starting || recordingOverlayState.recording) && mainWindowUnavailable;
  if (showLegacy || recordingOverlayProcess) sendRecordingOverlayState(showLegacy);
}

function createWindow() {
  appearanceTheme = readAppearance(app.getPath("userData"));
  nativeTheme.themeSource = themes[appearanceTheme].light ? "light" : "dark";
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 1060,
    minHeight: 720,
    ...windowAppearance(appearanceTheme),
    roundedCorners: true,
    title: "LocalFlow",
    icon: localFlowAssetPath("localflow-logo-512.png"),
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  require('./windows-glass.cjs').applyWindowGlass(mainWindow, themes[appearanceTheme].glass);
  const openDocumentLink = url => {
    try { if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch {}
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openDocumentLink(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { event.preventDefault(); openDocumentLink(url); });
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(appRoot(), "dist", "index.html"));
  }

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      setImmediate(syncRecordingOverlayWindow);
    }
  });
  mainWindow.on("blur", () => setShortcutCapture(false));
  mainWindow.webContents.on("did-start-loading", () => { setShortcutCapture(false); void niwaAgent?.stopVoice().catch(() => {}); });
  mainWindow.webContents.on("did-finish-load", syncRecordingOverlayWindow);
  mainWindow.webContents.on("render-process-gone", () => { setShortcutCapture(false); void niwaAgent?.stopVoice().catch(() => {}); });
  for (const eventName of ["minimize", "restore", "show", "hide", "move"]) {
    mainWindow.on(eventName, () => setImmediate(syncRecordingOverlayWindow));
  }
}

function tempAudioPath(extension = ".webm") {
  const safeExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const dir = process.env.LOCALFLOW_TEMP_DIR || path.join(appRoot(), "runtime", "temp");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `recording-${Date.now()}-${Math.random().toString(16).slice(2)}${safeExtension}`);
}

const pasteTextIntoActiveField = createPasteHandler({
  clipboard,
  getWorker: () => { startHotkeyWatcher(); return hotkeyWatcher; },
});

function selectedVoiceOutputModel() {
  const configured = String(process.env.LOCALFLOW_VOICE_OUTPUT_MODEL || "piper").trim().toLowerCase();
  return ALLOWED_VOICE_OUTPUT_MODELS.has(configured) ? configured : "piper";
}

function voiceOutputConfig() {
  const inventory = voiceOutputManager.inspect();
  return {
    model: selectedVoiceOutputModel(),
    voiceRoot: inventory.voiceRoot,
    options: inventory.options.map(({ python: _python, ...option }) => option),
  };
}

async function speakNiwaReply(reply) {
  const model = selectedVoiceOutputModel();
  const result = await voiceOutputManager.speak(model, String(reply || ""));
  return {
    model,
    log: JSON.stringify(result),
  };
}

function releaseAgentHotkey() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dictation-hotkey', { type: 'hotkey', action: 'niwa-agent', event: 'released' });
  }
}

function startHotkeyWatcher() {
  if (hotkeyWatcher && !hotkeyWatcher.killed) {
    return;
  }
  const script = hotkeyWatcherScriptPath();
  if (!fs.existsSync(script)) {
    return;
  }
  const python = resolvePython();
  const watcher = spawn(python.command, [...python.args, script], {
    cwd: resourcesRoot(),
    env: {
      ...process.env,
      LOCALFLOW_SHORTCUTS_JSON: JSON.stringify(readShortcuts(app.getPath("userData"))),
      LOCALFLOW_SHORTCUT_CAPTURE: shortcutCaptureActive ? "1" : "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  hotkeyWatcher = watcher;

  let buffer = "";
  watcher.stdout.setEncoding("utf8");
  watcher.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          const payload = JSON.parse(line);
          if (payload.type === "paste-result") {
            watcher.emit("paste-result", payload);
          } else if (payload.type === "shortcut-captured" && shortcutCaptureActive) {
            mainWindow?.webContents.send("shortcut-captured", payload.binding);
          } else if (payload.type === "hotkey" && (!shortcutCaptureActive || payload.event === 'released')) {
            mainWindow?.webContents.send("dictation-hotkey", payload);
          }
        } catch {
          // Ignore malformed watcher output.
        }
      }
      index = buffer.indexOf("\n");
    }
  });
  watcher.on("exit", () => {
    if (hotkeyWatcher === watcher) { hotkeyWatcher = null; releaseAgentHotkey(); }
  });
  watcher.on("error", () => {
    if (hotkeyWatcher === watcher) { hotkeyWatcher = null; releaseAgentHotkey(); }
  });
  watcher.stdin.on("error", () => {});
}

function setShortcutCapture(active) {
  if (active) releaseAgentHotkey();
  shortcutCaptureActive = active;
  if (hotkeyWatcher?.stdin.writable) {
    hotkeyWatcher.stdin.write(`${JSON.stringify({ capture: active })}\n`, () => {});
  }
}

function restartHotkeyWatcher() {
  releaseAgentHotkey();
  const previous = hotkeyWatcher;
  hotkeyWatcher = null;
  if (previous) terminateProcess(previous);
  startHotkeyWatcher();
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on("second-instance", () => showMainWindow());

app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  app.setAppUserModelId("local.localflow.desktop");
  const openNoteAsset = await registerNoteAssets(path.join(app.getPath('userData'), 'notes'));
  loadDotEnv();
  ensureRuntimeEnv();
  process.env.CODEX_HOME = path.join(app.getPath('userData'), 'niwa', 'codex');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(resourcesRoot(), 'runtime', 'browsers');
  process.env.LOCALFLOW_VOICE_OUTPUT_DIR = path.join(app.getPath('userData'), 'voice-output');
  const ttsRoot = resolveTtsRoot(appRoot(), app.isPackaged, process.env.LOCALAPPDATA || app.getPath("userData"));
  process.env.LOCALFLOW_VOICE_ROOT = ttsRoot;
  voiceOutputManager = createVoiceOutputManager(resourcesRoot());
  ensureShortcuts(app.getPath("userData"));
  Menu.setApplicationMenu(null);
  createWindow();
  cleanupAuthManager = createCleanupAuthManager({
    codexBin: () => process.env.LOCALFLOW_CODEX_BIN || resolveCodexBinary(),
    userDataPath: app.getPath("userData"),
    notify: (authStatus) => mainWindow?.webContents.send("cleanup-auth-event", authStatus),
    openBrowser: url => shell.openExternal(url),
  });
  edgePanel = createEdgePanel({ directory: app.getPath('userData'), display: recordingOverlayDisplay,
    onChange: syncRecordingOverlayWindow,
    onAction: action => {
      if (action !== 'microphone') showMainWindow();
      mainWindow?.webContents.send('edge-action', action);
    },
  });
  niwaReady = import('./niwa-agent.mjs').then(({ createNiwaAgent }) => {
    niwaAgent = createNiwaAgent({ directory: app.getPath('userData'), appRoot: appRoot(), binary: resolveNiwaCodexBinary,
      bundledConnectors: bundledConnectors(resourcesRoot()),
      captureScreen: (params, signal) => captureScreen({ desktopCapturer, screen }, params, signal),
      speak: speakNiwaReply,
      notify: payload => {
        mainWindow?.webContents.send('niwa-event', payload);
        if (payload.type === 'busy') edgePanel.update({ busy: payload.busy });
        if (payload.type === 'voice') edgePanel.update({ voice: payload.active, ...(payload.active ? { selected: 'agent' } : {}) });
        if (payload.type === 'approval') showMainWindow();
      },
    });
    return niwaAgent;
  });
  niwaReady.catch(error => mainWindow?.webContents.send('niwa-event', { type: 'error', message: error.message }));
  syncRecordingOverlayWindow();
  createTray();
  startHotkeyWatcher();

  screen.on("display-metrics-changed", syncRecordingOverlayWindow);
  screen.on("display-added", syncRecordingOverlayWindow);
  screen.on("display-removed", syncRecordingOverlayWindow);

  duplexCleanup = createDuplexCleanup({ BrowserWindow, binary: resolveNiwaCodexBinary, directory: app.getPath('userData') });
  transcriptionWorker = createTranscriptionWorker({
    python: resolvePython(), script: workerScriptPath(), cwd: resourcesRoot(),
    notify: (payload) => mainWindow?.webContents.send("worker-progress", payload),
    cleanup: (payload, signal) => duplexCleanup.clean(payload, signal),
  });
  transcriptionWorker.send("warmup").catch((error) => {
    if (error.code === "CANCELLED") return;
    mainWindow?.webContents.send("worker-progress", {
      type: "progress",
      stage: "warmup-failed",
      message: `STT warmup failed: ${error.message}`,
    });
  });

  ipcMain.handle("get-appearance", () => appearanceTheme);
  ipcMain.handle("set-appearance", (event, theme) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Appearance is only available in the main window");
    saveAppearance(app.getPath("userData"), theme);
    applyAppearance(mainWindow, nativeTheme, theme);
    appearanceTheme = theme;
    edgePanel?.update({ theme });
    return theme;
  });

  ipcMain.handle("select-audio-file", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose audio",
      properties: ["openFile"],
      filters: [
        {
          name: "Audio",
          extensions: ["wav", "mp3", "m4a", "mp4", "webm", "ogg", "aac", "flac"],
        },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("save-audio-buffer", async (_event, payload) => {
    const bytes = Buffer.from(payload.buffer);
    const targetPath = tempAudioPath(payload.extension || ".webm");
    await fs.promises.writeFile(targetPath, bytes);
    return targetPath;
  });

  ipcMain.handle("transcribe-file", async (_event, payload) => {
    try {
      return { ok: true, data: await transcriptionWorker.send("transcribe", payload, payload.requestId) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("cancel-transcription", () => transcriptionWorker.stop());

  ipcMain.handle("set-whisper-model", async (_event, model) => {
    if (!ALLOWED_WHISPER_MODELS.has(model)) {
      throw new Error(`Unsupported STT model: ${model}`);
    }
    process.env.LOCALFLOW_WHISPER_MODEL = model;
    persistDotEnvValue("LOCALFLOW_WHISPER_MODEL", model);
    await transcriptionWorker.send("configure", { model });
    return {
      whisperModel: model,
      whisperDownloadRoot: ONNX_STT_MODELS.has(model)
        ? process.env.HUGGINGFACE_HUB_CACHE
        : process.env.LOCALFLOW_WHISPER_DOWNLOAD_ROOT,
    };
  });

  ipcMain.handle("set-whisper-language", async (_event, language) => {
    const normalized = String(language || "").trim().toLowerCase();
    if (!ALLOWED_WHISPER_LANGUAGES.has(normalized)) {
      throw new Error(`Unsupported transcription language: ${language}`);
    }
    process.env.LOCALFLOW_WHISPER_LANGUAGE = normalized;
    persistDotEnvValue("LOCALFLOW_WHISPER_LANGUAGE", normalized);
    await transcriptionWorker.send("configure", { language: normalized });
    return { language: normalized, outputLanguage: WHISPER_OUTPUT_LANGUAGES[normalized] };
  });

  ipcMain.handle("cleanup-auth-status", () => cleanupAuthManager.inspect());
  ipcMain.handle('get-cleanup-models', async event => {
    fromMain(event);
    const selected = process.env.LOCALFLOW_CLEANUP_MODEL || 'gpt-5.6-terra';
    let models = [], error = '';
    try { models = (await cleanupAuthManager.models()).map(model => ({ id: model.model, label: model.displayName })); }
    catch (failure) { error = failure.message; }
    if (!models.some(model => model.id === selected) && selected !== LIVE_MODEL) models.unshift({ id: selected, label: selected });
    return { selected, models: [...models.filter(model => model.id !== LIVE_MODEL), { id: LIVE_MODEL, label: 'Live 1 · realtime cleanup' }], error };
  });
  ipcMain.handle('set-cleanup-model', async (event, model) => {
    fromMain(event);
    if (model !== LIVE_MODEL && !(await cleanupAuthManager.models()).some(item => item.model === model)) throw new Error('Select an available cleanup model.');
    await transcriptionWorker.send('configure', { cleanupModel: model });
    process.env.LOCALFLOW_CLEANUP_MODEL = model;
    persistDotEnvValue('LOCALFLOW_CLEANUP_MODEL', model);
    return model;
  });
  ipcMain.handle("cleanup-auth-connect-codex", () => { niwaAgent?.disconnect(); return cleanupAuthManager.connectCodex(); });
  ipcMain.handle("cleanup-auth-connect-api-key", (_event, apiKey) => { niwaAgent?.disconnect(); return cleanupAuthManager.connectApiKey(apiKey); });
  ipcMain.handle("cleanup-auth-disconnect", () => { niwaAgent?.disconnect(); return cleanupAuthManager.disconnect(); });
  ipcMain.handle("cleanup-auth-cancel", () => cleanupAuthManager.cancel());
  ipcMain.handle("cleanup-auth-open-browser", () => cleanupAuthManager.openCurrentBrowser());

  ipcMain.handle("get-voice-output-config", async () => voiceOutputConfig());

  ipcMain.handle("set-voice-output-model", async (_event, model) => {
    const normalized = String(model || "").trim().toLowerCase();
    if (!ALLOWED_VOICE_OUTPUT_MODELS.has(normalized)) {
      throw new Error(`Unsupported voice output model: ${model}`);
    }
    let inventory = voiceOutputManager.inspect();
    let option = inventory.options.find((item) => item.id === normalized);
    if (!option?.available && normalized !== "xvasynth") {
      await ensureTtsRuntime(resourcesRoot(), inventory.voiceRoot, normalized);
      inventory = voiceOutputManager.inspect();
      option = inventory.options.find((item) => item.id === normalized);
    }
    if (!option?.available) {
      throw new Error(option?.detail || `${normalized} is not installed`);
    }
    voiceOutputManager.stop();
    process.env.LOCALFLOW_VOICE_OUTPUT_MODEL = normalized;
    persistDotEnvValue("LOCALFLOW_VOICE_OUTPUT_MODEL", normalized);
    return voiceOutputConfig();
  });

  ipcMain.handle("export-text", async (_event, payload) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export text",
      defaultPath: payload.defaultName || "localflow-transcript.txt",
      filters: [{ name: "Text", extensions: ["txt", "md"] }],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await fs.promises.writeFile(result.filePath, payload.text || "", "utf8");
    return result.filePath;
  });

  ipcMain.handle("copy-text", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return true;
  });

  ipcMain.handle('get-shortcuts', () => readShortcuts(app.getPath('userData')));
  const fromMain = event => { if (event.sender !== mainWindow?.webContents) throw new Error('This operation belongs to the main window.'); };
  let writingBusy = false;
  ipcMain.handle('notes-skill', async (event, value) => {
    fromMain(event);
    if (writingBusy) throw new Error('A writing skill is already running.');
    writingBusy = true;
    try { return await require('./notes/skills.cjs').runNoteSkill({ directory: app.getPath('userData'), binary: resolveNiwaCodexBinary, settings: (await niwaReady).snapshot().settings }, value); }
    finally { writingBusy = false; }
  });
  ipcMain.handle('notes-open-asset', (event, url) => { fromMain(event); return openNoteAsset(url); });
  ipcMain.handle('notes-upload-assets', async(event,files)=>{fromMain(event);return (await import('./notes/uploads.mjs')).storeUploads(path.join(app.getPath('userData'),'notes'),files);});
  ipcMain.handle('notes-pick-assets', async event=>{fromMain(event);const choice=await dialog.showOpenDialog(mainWindow,{title:'Add images or files',properties:['openFile','multiSelections']});if(choice.canceled)return [];return (await import('./notes/uploads.mjs')).importUploadPaths(path.join(app.getPath('userData'),'notes'),choice.filePaths);});
  ipcMain.handle('notes-export-pdf', async(event,value)=>{fromMain(event);if(typeof value?.title!=='string'||typeof value?.html!=='string')throw new Error('Invalid page export.');const choice=await dialog.showSaveDialog(mainWindow,{title:'Export PDF',defaultPath:value.title.replace(/[<>:"/\\|?*]/g,'-')+'.pdf',filters:[{name:'PDF document',extensions:['pdf']}]});if(choice.canceled||!choice.filePath)return null;return require('./notes/pdf.cjs').exportPdf(path.join(app.getPath('userData'),'notes'),value,choice.filePath);});
  ipcMain.handle('notes-import-notion', async event => {
    fromMain(event);
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'Import Notion export', properties: ['openFile'], filters: [{ name: 'Notion export', extensions: ['zip'] }] });
    if (choice.canceled) return null;
    const { prepareNotionImport } = await import('./notes/notion-import.mjs');
    const location = await dialog.showOpenDialog(mainWindow, { title: 'Choose where to keep the imported Notion attachments', defaultPath: path.dirname(choice.filePaths[0]), properties: ['openDirectory','createDirectory'] });
    if (location.canceled) return null;
    const bundle = await prepareNotionImport(choice.filePaths[0], path.join(app.getPath('userData'),'notes'), { python: resolvePython(), storageRoot: path.join(location.filePaths[0],'LocalFlow Notes') });
    const result = (await niwaReady).notes.importBundle(bundle);
    return { ...result, report: bundle.report };
  });
  ipcMain.handle('get-edge-settings', event => { fromMain(event); return edgePanel.get(); });
  ipcMain.handle('set-edge-settings', (event, value) => { fromMain(event); return edgePanel.set(value); });
  for (const [channel, method] of Object.entries({
    'niwa-projects': 'projects', 'niwa-open-folder': 'openFolder', 'niwa-new-chat': 'newChat', 'niwa-select-chat': 'selectChat', 'niwa-rename-chat': 'renameChat', 'niwa-manage-project': 'manageProject',
    'niwa-undo-changes': 'undoChanges', 'niwa-snapshot': 'snapshot', 'niwa-connect': 'connect', 'niwa-send': 'send', 'niwa-start-voice': 'startVoice',
    'niwa-disconnect-browser': 'disconnectBrowser',
    'niwa-stop-voice': 'stopVoice', 'niwa-interrupt': 'interrupt', 'niwa-configure': 'configure',
    'niwa-save-connector': 'saveConnector', 'niwa-forget': 'forget',
  })) ipcMain.handle(channel, async (event, value) => { fromMain(event); const agent = await niwaReady; return agent[method](value); });
  for (const method of ['list', 'read', 'create', 'save', 'remove', 'duplicate', 'importLegacy', 'rename', 'move', 'databaseRead', 'databaseSave', 'databaseAddRow', 'databaseMoveRow', 'databaseRunButton', 'databaseQuery']) {
    ipcMain.handle(`notes-${method}`, async (event, value) => { fromMain(event); return (await niwaReady).notes[method](value); });
  }
  ipcMain.handle('niwa-select-files', async event => { fromMain(event); const choice = await dialog.showOpenDialog(mainWindow, { title: 'Add files to chat', properties: ['openFile', 'multiSelections'] }); return choice.canceled ? [] : choice.filePaths; });
  ipcMain.handle('niwa-add-project', async event => {
    fromMain(event); const agent = await niwaReady;
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'Choose a project', properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled) return null;
    return agent.addProject({ path: choice.filePaths[0] });
  });
  ipcMain.handle('niwa-respond', async (event, id, answer) => { fromMain(event); return (await niwaReady).respond(id, answer); });
  ipcMain.handle('niwa-connect-browser', async event => { fromMain(event); return connectChrome(await niwaReady); });

  ipcMain.handle("set-shortcut-capture", (event, active) => {
    if (event.sender !== mainWindow?.webContents || typeof active !== "boolean") {
      throw new Error("Invalid shortcut capture request.");
    }
    startHotkeyWatcher();
    setShortcutCapture(active);
  });

  ipcMain.handle("set-shortcut", async (_event, payload) => {
    const config = saveShortcut(
      app.getPath("userData"),
      payload?.action,
      payload?.binding,
    );
    restartHotkeyWatcher();
    return config;
  });

  ipcMain.handle("open-path", async (_event, filePath) => {
    return shell.openPath(filePath);
  });

  ipcMain.handle("paste-text", async (_event, text) => {
    return pasteTextIntoActiveField(text);
  });

  ipcMain.on("recording-overlay-state", (event, payload) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return;
    }
    const elapsedSeconds = Number(payload?.elapsedSeconds);
    const starting = payload?.starting === true;
    if (['agent', 'microphone', 'notes'].includes(payload?.selected)) edgePanel?.update({ selected: payload.selected });
    const warmup = starting && !recordingOverlayState.starting && !recordingOverlayState.recording;
    recordingOverlayState = {
      recording: payload?.recording === true,
      starting,
      agentListening: payload?.agentListening === true,
      recordingTarget: payload?.recordingTarget === 'agent' ? 'agent' : 'microphone',
      elapsedSeconds: Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0,
    };
    syncRecordingOverlayWindow();
    if (warmup) { voiceOutputManager?.stop(); transcriptionWorker.send("warmup").catch(() => {}); }
  });

});

app.on("window-all-closed", () => {
  // Keep running from the system tray.
});

app.on("activate", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  transcriptionWorker?.stop();
  duplexCleanup?.close();
  if (hotkeyWatcher && !hotkeyWatcher.killed) {
    terminateProcess(hotkeyWatcher);
  }
  if (recordingOverlayProcess && !recordingOverlayProcess.killed) {
    if (recordingOverlayProcess.stdin.writable) {
      recordingOverlayProcess.stdin.write(`${JSON.stringify({ type: "quit" })}\n`, () => {});
    } else {
      recordingOverlayProcess.kill();
    }
  }
  voiceOutputManager?.stop();
  edgePanel?.close();
  void niwaAgent?.close();
  cleanupAuthManager?.close();
});
