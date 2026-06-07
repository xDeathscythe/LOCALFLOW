const { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let tray = null;
let worker = null;
let hotkeyWatcher = null;
let workerBuffer = "";
let requestSeq = 0;
let isQuitting = false;
const pending = new Map();
const ALLOWED_WHISPER_MODELS = new Set(["large-v3-turbo", "large-v3"]);

function appRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
}

function loadDotEnv() {
  const envPath = path.join(appRoot(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function persistDotEnvValue(key, value) {
  const envPath = path.join(appRoot(), ".env");
  const line = `${key}=${value}`;
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `${line}\n`, "utf8");
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  let updated = false;
  const nextLines = lines.map((currentLine) => {
    const trimmed = currentLine.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return currentLine;
    }
    const currentKey = trimmed.slice(0, trimmed.indexOf("=")).trim();
    if (currentKey !== key) {
      return currentLine;
    }
    updated = true;
    return line;
  });
  if (!updated) {
    nextLines.push(line);
  }
  fs.writeFileSync(envPath, `${nextLines.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
}

function ensureRuntimeEnv() {
  const runtimeDir = process.env.LOCALFLOW_DATA_DIR || path.join(appRoot(), "runtime");
  const cacheDir = path.join(runtimeDir, "cache");
  const tempDir = path.join(runtimeDir, "temp");
  const hfDir = path.join(cacheDir, "huggingface");
  const cudaBinDir = process.env.LOCALFLOW_CUDA_BIN || path.join(runtimeDir, "cuda", "bin");

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(hfDir, { recursive: true });
  fs.mkdirSync(cudaBinDir, { recursive: true });

  process.env.LOCALFLOW_DATA_DIR = runtimeDir;
  process.env.LOCALFLOW_TEMP_DIR = process.env.LOCALFLOW_TEMP_DIR || tempDir;
  process.env.TMP = process.env.LOCALFLOW_TEMP_DIR;
  process.env.TEMP = process.env.LOCALFLOW_TEMP_DIR;
  process.env.HF_HOME = process.env.HF_HOME || hfDir;
  process.env.HUGGINGFACE_HUB_CACHE = process.env.HUGGINGFACE_HUB_CACHE || path.join(hfDir, "hub");
  process.env.HF_HUB_CACHE = process.env.HF_HUB_CACHE || process.env.HUGGINGFACE_HUB_CACHE;
  process.env.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || cacheDir;
  process.env.PYTHONIOENCODING = "utf-8";
  process.env.LOCALFLOW_CUDA_BIN = cudaBinDir;
  process.env.PATH = `${cudaBinDir}${path.delimiter}${process.env.PATH || ""}`;
}

function resolvePython() {
  const root = appRoot();
  const venvPython = path.join(root, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvPython)) {
    return { command: venvPython, args: [] };
  }
  if (process.env.LOCALFLOW_PYTHON) {
    return { command: process.env.LOCALFLOW_PYTHON, args: [] };
  }
  return { command: "py", args: ["-3.11"] };
}

function workerScriptPath() {
  const root = appRoot();
  const packaged = path.join(process.resourcesPath || root, "backend", "worker.py");
  if (app.isPackaged && fs.existsSync(packaged)) {
    return packaged;
  }
  return path.join(root, "backend", "worker.py");
}

function hotkeyWatcherScriptPath() {
  return path.join(appRoot(), "backend", "hotkey_watcher.py");
}

function createTrayImage() {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="#159aa1"/>
      <rect x="7" y="6" width="4" height="20" rx="2" fill="#ffffff"/>
      <rect x="14" y="10" width="4" height="12" rx="2" fill="#ffffff"/>
      <rect x="21" y="4" width="4" height="24" rx="2" fill="#ffffff"/>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: "#f6f7f8",
    title: "LocalFlow",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(appRoot(), "dist", "index.html"));
  }

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function ensureWorker() {
  if (worker && !worker.killed) {
    return worker;
  }

  loadDotEnv();
  ensureRuntimeEnv();
  const python = resolvePython();
  const script = workerScriptPath();
  worker = spawn(python.command, [...python.args, script], {
    cwd: appRoot(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const spawnedWorker = worker;
  let spawnedWorkerBuffer = "";

  spawnedWorker.stdout.setEncoding("utf8");
  spawnedWorker.stdout.on("data", (chunk) => {
    spawnedWorkerBuffer += chunk;
    let index = spawnedWorkerBuffer.indexOf("\n");
    while (index >= 0) {
      const line = spawnedWorkerBuffer.slice(0, index).trim();
      spawnedWorkerBuffer = spawnedWorkerBuffer.slice(index + 1);
      if (line) {
        handleWorkerLine(line);
      }
      index = spawnedWorkerBuffer.indexOf("\n");
    }
  });

  spawnedWorker.stderr.setEncoding("utf8");
  spawnedWorker.stderr.on("data", (chunk) => {
    mainWindow?.webContents.send("worker-progress", {
      type: "stderr",
      message: chunk.toString(),
    });
  });

  spawnedWorker.on("exit", (code) => {
    for (const [id, entry] of pending) {
      if (entry.worker === spawnedWorker) {
        entry.reject(new Error(`Local worker exited with code ${code}`));
        pending.delete(id);
      }
    }
    if (worker === spawnedWorker) {
      worker = null;
      workerBuffer = "";
    }
  });

  return worker;
}

function handleWorkerLine(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    mainWindow?.webContents.send("worker-progress", {
      type: "log",
      message: line,
    });
    return;
  }

  if (payload.type === "ready") {
    mainWindow?.webContents.send("worker-progress", payload);
    return;
  }

  if (payload.type === "progress" || payload.type === "partial-result") {
    mainWindow?.webContents.send("worker-progress", payload);
    return;
  }

  if (payload.type === "result" && payload.id && pending.has(payload.id)) {
    const entry = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.ok) {
      entry.resolve(payload.data);
    } else {
      const detail = payload.trace ? `${payload.error || "Local transcription failed"}\n\n${payload.trace}` : payload.error;
      entry.reject(new Error(detail || "Local transcription failed"));
    }
  }
}

function sendWorker(action, params) {
  const activeWorker = ensureWorker();
  const id = String(++requestSeq);
  const payload = JSON.stringify({ id, action, params }) + "\n";
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker: activeWorker });
    activeWorker.stdin.write(payload, "utf8", (error) => {
      if (error) {
        pending.delete(id);
        reject(error);
      }
    });
  });
}

function restartWorker() {
  if (worker && !worker.killed) {
    worker.kill();
  }
  worker = null;
  workerBuffer = "";
}

function tempAudioPath(extension = ".webm") {
  const safeExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const dir = process.env.LOCALFLOW_TEMP_DIR || path.join(appRoot(), "runtime", "temp");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `recording-${Date.now()}-${Math.random().toString(16).slice(2)}${safeExtension}`);
}

function pasteTextIntoActiveField(text) {
  if (!text || !text.trim()) {
    return Promise.resolve(false);
  }
  clipboard.writeText(text);
  const python = resolvePython();
  const script = [
    "import ctypes, time",
    "user32 = ctypes.windll.user32",
    "VK_CONTROL = 0x11",
    "VK_V = 0x56",
    "KEYEVENTF_KEYUP = 0x0002",
    "time.sleep(0.08)",
    "user32.keybd_event(VK_CONTROL, 0, 0, 0)",
    "user32.keybd_event(VK_V, 0, 0, 0)",
    "user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)",
    "user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)",
  ].join("; ");
  return new Promise((resolve) => {
    const child = spawn(python.command, [...python.args, "-c", script], {
      cwd: appRoot(),
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
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
  hotkeyWatcher = spawn(python.command, [...python.args, script], {
    cwd: appRoot(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let buffer = "";
  hotkeyWatcher.stdout.setEncoding("utf8");
  hotkeyWatcher.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          const payload = JSON.parse(line);
          if (payload.type === "hotkey") {
            mainWindow?.webContents.send("dictation-hotkey", payload);
          }
        } catch {
          // Ignore malformed watcher output.
        }
      }
      index = buffer.indexOf("\n");
    }
  });
  hotkeyWatcher.on("exit", () => {
    hotkeyWatcher = null;
  });
}

app.whenReady().then(() => {
  loadDotEnv();
  ensureRuntimeEnv();
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  startHotkeyWatcher();

  setTimeout(() => {
    sendWorker("warmup", {}).catch((error) => {
      mainWindow?.webContents.send("worker-progress", {
        type: "progress",
        stage: "warmup-failed",
        message: `Whisper GPU warmup failed: ${error.message}`,
      });
    });
  }, 750);

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
    const bytes = Buffer.from(new Uint8Array(payload.buffer));
    const targetPath = tempAudioPath(payload.extension || ".webm");
    fs.writeFileSync(targetPath, bytes);
    return targetPath;
  });

  ipcMain.handle("transcribe-file", async (_event, payload) => {
    return sendWorker("transcribe", payload);
  });

  ipcMain.handle("set-whisper-model", async (_event, model) => {
    if (!ALLOWED_WHISPER_MODELS.has(model)) {
      throw new Error(`Unsupported Whisper model: ${model}`);
    }
    process.env.LOCALFLOW_WHISPER_MODEL = model;
    persistDotEnvValue("LOCALFLOW_WHISPER_MODEL", model);
    restartWorker();
    await sendWorker("warmup", {});
    return {
      whisperModel: model,
      whisperDownloadRoot: process.env.LOCALFLOW_WHISPER_DOWNLOAD_ROOT || "X:\\stt-models",
    };
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
    fs.writeFileSync(result.filePath, payload.text || "", "utf8");
    return result.filePath;
  });

  ipcMain.handle("open-path", async (_event, filePath) => {
    return shell.openPath(filePath);
  });

  ipcMain.handle("paste-text", async (_event, text) => {
    return pasteTextIntoActiveField(text);
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
  if (worker && !worker.killed) {
    worker.kill();
  }
  if (hotkeyWatcher && !hotkeyWatcher.killed) {
    hotkeyWatcher.kill();
  }
});
