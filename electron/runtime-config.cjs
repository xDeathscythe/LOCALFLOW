const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const BUNDLED_WHISPER_MODELS = ["large-v3"];

function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, "..");
}

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : appRoot();
}

function dotEnvPath() {
  return app.isPackaged ? path.join(app.getPath("userData"), ".env") : path.join(appRoot(), ".env");
}

function loadDotEnv() {
  const envPath = dotEnvPath();
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

function resolveCodexBinary() {
  const configured = process.env.LOCALFLOW_CODEX_BIN;
  const candidates = [
    configured,
    path.join(process.resourcesPath || "", "app.asar.unpacked", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
    !app.isPackaged && path.join(appRoot(), "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
  ].filter(Boolean);
  const binary = candidates.find((candidate) => fs.existsSync(candidate));
  if (!binary) throw new Error('LocalFlow Codex runtime is missing. Repair the installation or run npm ci in the source checkout.');
  return binary;
}

function resolveNiwaCodexBinary() {
  if (process.env.LOCALFLOW_NIWA_CODEX_BIN) return process.env.LOCALFLOW_NIWA_CODEX_BIN;
  return resolveCodexBinary();
}

function bundledWhisperRoot() {
  const candidates = [
    path.join(process.resourcesPath || "", "models", "whisper"),
    path.join(appRoot(), "models", "whisper"),
  ];
  return candidates.find((candidate) =>
    BUNDLED_WHISPER_MODELS.every((model) => fs.existsSync(path.join(candidate, model, "model.bin")))
  );
}

function persistDotEnvValue(key, value) {
  const envPath = dotEnvPath();
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
  const bundledRuntimeDir = path.join(resourcesRoot(), "runtime");
  const defaultRuntimeDir = app.isPackaged
    ? path.join(app.getPath("userData"), "runtime")
    : bundledRuntimeDir;
  const runtimeDir = process.env.LOCALFLOW_DATA_DIR || defaultRuntimeDir;
  const cacheDir = path.join(runtimeDir, "cache");
  const tempDir = path.join(runtimeDir, "temp");
  const hfDir = path.join(cacheDir, "huggingface");
  const bundledCudaBinDir = path.join(bundledRuntimeDir, "cuda", "bin");
  const cudaBinDir = process.env.LOCALFLOW_CUDA_BIN || (fs.existsSync(bundledCudaBinDir)
    ? bundledCudaBinDir
    : path.join(runtimeDir, "cuda", "bin"));
  const bundledPythonPackages = path.join(bundledRuntimeDir, "python-packages");

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
  process.env.LOCALFLOW_CODEX_BIN = resolveCodexBinary();
  process.env.LOCALFLOW_WHISPER_DOWNLOAD_ROOT = process.env.LOCALFLOW_WHISPER_DOWNLOAD_ROOT || (!app.isPackaged && bundledWhisperRoot()) || path.join(runtimeDir, "models", "whisper");
  if (fs.existsSync(bundledPythonPackages)) {
    process.env.PYTHONPATH = [bundledPythonPackages, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  }
  process.env.PATH = `${cudaBinDir}${path.delimiter}${process.env.PATH || ""}`;
}

function resolvePython() {
  const bundledPython = path.join(resourcesRoot(), "runtime", "python", "python.exe");
  if (fs.existsSync(bundledPython)) {
    return { command: bundledPython, args: [] };
  }
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

module.exports = { appRoot, resourcesRoot, loadDotEnv, persistDotEnvValue, ensureRuntimeEnv, resolvePython, resolveCodexBinary, resolveNiwaCodexBinary, BUNDLED_WHISPER_MODELS };
