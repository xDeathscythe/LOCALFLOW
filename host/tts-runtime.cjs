const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { terminateProcess } = require("./child-process.cjs");

function resolveTtsRoot(appRoot, isPackaged, localAppData) {
  const configured = String(process.env.LOCALFLOW_VOICE_ROOT || "").trim();
  if (configured) {
    return path.resolve(appRoot, configured);
  }
  if (isPackaged) {
    return path.join(localAppData, "LocalFlow", "tts");
  }
  return path.join(appRoot, "runtime", "tts");
}

function ttsRuntimeReady(root, engine) {
  const required = [
    "piper/.venv/Scripts/python.exe",
    "piper/voices/en_US-kristin-medium.onnx",
    "xtts/.venv/Scripts/python.exe",
    "xtts/models/tts/tts_models--multilingual--multi-dataset--xtts_v2/model.pth",
    "omnivoice/.venv/Scripts/python.exe",
    "omnivoice/hf_home/hub/models--k2-fsa--OmniVoice/snapshots/c5fdb5ccb189668d56333f77ba2629f4cd7535f4/config.json",
    "omnivoice/hf_home/hub/models--openai--whisper-large-v3-turbo/snapshots/41f01f3fe87f28c78e2fbf8b568835947dd65ed9/config.json",
    "shared/refs/hermes-reference.wav",
    "shared/refs/telegram_audio_5212538fe527_mono24k.wav",
  ];
  return required.filter((file) => !engine || file.startsWith(`${engine}/`) || (engine !== 'piper' && file.startsWith("shared/")))
    .every((relativePath) => fs.existsSync(path.join(root, relativePath)));
}

function runInstaller(resourcesRoot, ttsRoot, engine) {
  const script = path.join(resourcesRoot, "scripts", "install-tts.ps1");
  if (!fs.existsSync(script)) {
    return Promise.reject(new Error(`TTS installer missing: ${script}`));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", script,
        "-ResourcesRoot", resourcesRoot,
        "-TtsRoot", ttsRoot,
        ...(engine ? ["-OnlyEngine", engine] : []),
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const timeout = setTimeout(() => {
      terminateProcess(child);
      reject(new Error("Voice runtime installation timed out"));
    }, 5 * 60 * 1000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output = `${output}${chunk}`.slice(-16000);
      });
    }
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`TTS installer exited with code ${code}: ${output.trim()}`));
    });
  });
}

const installations = new Map();
async function ensureTtsRuntime(resourcesRoot, ttsRoot, engine, confirm) {
  if (ttsRuntimeReady(ttsRoot, engine)) return { root: ttsRoot, installed: false };
  const key = `${ttsRoot}:${engine || "all"}`;
  if (!installations.has(key)) installations.set(key, (async () => {
    if (!confirm || !await confirm(engine || "voice models")) {
      throw new Error("Model download cancelled");
    }
    await runInstaller(resourcesRoot, ttsRoot, engine);
  })().finally(() => installations.delete(key)));
  await installations.get(key);
  if (!ttsRuntimeReady(ttsRoot, engine)) {
    throw new Error(`TTS installer completed but runtime is incomplete: ${ttsRoot}`);
  }
  return { root: ttsRoot, installed: true };
}

module.exports = { ensureTtsRuntime, resolveTtsRoot, ttsRuntimeReady };
