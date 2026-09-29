const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ensureTtsRuntime } = require("./tts-runtime.cjs");
const { terminateProcess } = require("./child-process.cjs");

const ALLOWED_VOICE_OUTPUT_MODELS = new Set(["xtts", "xvasynth", "piper", "omnivoice"]);

const MODEL_METADATA = Object.freeze({
  piper: {
    label: "Piper",
    description: "Brz ženski English glas. Ne zauzima GPU.",
  },
  xtts: {
    label: "XTTS",
    description: "CUDA voice cloning sa English Niwa odgovorima.",
  },
  omnivoice: {
    label: "OmniVoice",
    description: "CUDA voice cloning sa podrškom za više od 600 jezika.",
  },
  xvasynth: {
    label: "xVASynth",
    description: "Character voice engine. Zahteva Steam aplikaciju i voice pack.",
  },
});

function findXvaSynthRoot(voiceRoot) {
  const candidates = [
    process.env.LOCALFLOW_XVASYNTH_ROOT,
    path.join(voiceRoot, "xvasynth"),
    "X:\\New folder\\stema\\steamapps\\common\\xVASynth",
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\xVASynth",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "xVASynth.exe"))) || null;
}

function findXvaSynthVoice(root) {
  if (!root) return null;
  const modelsRoot = path.join(root, "resources", "app", "models");
  if (!fs.existsSync(modelsRoot)) return null;
  const configured = String(process.env.LOCALFLOW_XVASYNTH_VOICE || "").trim();
  const stack = [modelsRoot];
  const candidates = [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        const base = target.slice(0, -5);
        if (fs.existsSync(`${base}.pt`) && (!configured || path.basename(base) === configured)) {
          candidates.push(target);
        }
      }
    }
  }
  return candidates.sort()[0] || null;
}

function inspectVoiceOutputModels() {
  const voiceRoot = process.env.LOCALFLOW_VOICE_ROOT || path.join(__dirname, "..", "runtime", "tts");
  const xttsReference = process.env.LOCALFLOW_XTTS_REFERENCE_AUDIO
    || path.join(voiceRoot, "shared", "refs", "hermes-reference.wav");
  const omniReference = process.env.LOCALFLOW_OMNIVOICE_REFERENCE_AUDIO
    || path.join(voiceRoot, "shared", "refs", "telegram_audio_5212538fe527_mono24k.wav");
  const piperPython = path.join(voiceRoot, "piper", ".venv", "Scripts", "python.exe");
  const piperVoice = process.env.LOCALFLOW_PIPER_VOICE || "en_US-kristin-medium";
  const piperModel = path.join(voiceRoot, "piper", "voices", `${piperVoice}.onnx`);
  const xttsPython = path.join(voiceRoot, "xtts", ".venv", "Scripts", "python.exe");
  const xttsModel = path.join(
    voiceRoot,
    "xtts",
    "models",
    "tts",
    "tts_models--multilingual--multi-dataset--xtts_v2",
    "model.pth",
  );
  const omniPython = path.join(voiceRoot, "omnivoice", ".venv", "Scripts", "python.exe");
  const omniModel = process.env.LOCALFLOW_OMNIVOICE_MODEL || path.join(
    voiceRoot,
    "omnivoice",
    "hf_home",
    "hub",
    "models--k2-fsa--OmniVoice",
    "snapshots",
    "c5fdb5ccb189668d56333f77ba2629f4cd7535f4",
  );
  const xvaRoot = findXvaSynthRoot(voiceRoot);
  const xvaVoice = findXvaSynthVoice(xvaRoot);

  return {
    voiceRoot,
    options: [
      {
        id: "piper",
        ...MODEL_METADATA.piper,
        available: fs.existsSync(piperPython) && fs.existsSync(piperModel),
        detail: `${piperVoice} · female · English · CPU`,
        python: piperPython,
      },
      {
        id: "xtts",
        ...MODEL_METADATA.xtts,
        available: fs.existsSync(xttsPython) && fs.existsSync(xttsModel) && fs.existsSync(xttsReference),
        detail: "XTTS-v2 · CUDA · English clone",
        python: xttsPython,
      },
      {
        id: "omnivoice",
        ...MODEL_METADATA.omnivoice,
        available: fs.existsSync(omniPython) && fs.existsSync(omniModel) && fs.existsSync(omniReference),
        detail: "Devona clone · Serbian · 32 steps · speed 0.95",
        python: omniPython,
      },
      {
        id: "xvasynth",
        ...MODEL_METADATA.xvasynth,
        available: Boolean(xvaRoot && xvaVoice),
        detail: xvaRoot
          ? (xvaVoice ? `${path.basename(xvaVoice, ".json")} · ${xvaRoot}` : "Aplikacija instalirana · voice pack nedostaje")
          : "Prijava na Steam i voice pack su još potrebni",
        python: piperPython,
      },
    ],
  };
}

function createVoiceOutputManager(appRoot, { startupTimeoutMs = 120000, speechTimeoutMs = 360000 } = {}) {
  let worker = null;
  let workerEngine = null;
  let workerBuffer = "";
  let workerErrors = "";
  let readyPromise = null;
  let readyResolve = null;
  let readyReject = null;
  let requestSeq = 0;
  let startupTimer = null;
  let speaking = false;
  let generation = 0;
  const pending = new Map();

  function stop(error = new Error("Voice output worker stopped")) {
    generation += 1;
    clearTimeout(startupTimer);
    rejectStartup(error);
    terminateProcess(worker);
    worker = null;
    workerEngine = null;
    workerBuffer = "";
    readyPromise = null;
    for (const request of pending.values()) {
      request.reject(error);
      clearTimeout(request.timer);
    }
    pending.clear();
  }

  function rejectStartup(error) {
    readyReject?.(error);
    readyReject = null;
    readyResolve = null;
  }

  function handlePayload(payload) {
    if (payload?.type === "ready") {
      clearTimeout(startupTimer);
      readyResolve?.(payload);
      readyResolve = null;
      readyReject = null;
      return;
    }
    const request = pending.get(payload?.id);
    if (!request) return;
    pending.delete(payload.id);
    clearTimeout(request.timer);
    if (payload.success) request.resolve(payload);
    else request.reject(new Error(payload.error || "Voice output failed"));
  }

  function ensureWorker(engine) {
    if (worker && workerEngine === engine && !worker.killed && readyPromise) return readyPromise;
    stop();
    const inventory = inspectVoiceOutputModels();
    const option = inventory.options.find((item) => item.id === engine);
    if (!option || !option.available) {
      throw new Error(option?.detail || `Voice output model is not available: ${engine}`);
    }
    if (!option.python) throw new Error(`Python runtime is missing for ${engine}`);
    const script = path.join(appRoot, "backend", "voice_output_worker.py");
    if (!fs.existsSync(script)) throw new Error(`Voice output worker not found: ${script}`);

    workerEngine = engine;
    workerErrors = "";
    readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const child = spawn(option.python, ["-u", script, "--engine", engine], {
      cwd: appRoot,
      env: { ...process.env, PYTHONPATH: "" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    worker = child;
    startupTimer = setTimeout(() => stop(new Error(`${engine} model loading timed out`)), startupTimeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (worker !== child) return;
      workerBuffer += chunk;
      let newline = workerBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = workerBuffer.slice(0, newline).trim();
        workerBuffer = workerBuffer.slice(newline + 1);
        if (line) {
          try {
            handlePayload(JSON.parse(line));
          } catch {
            workerErrors = `${workerErrors}\n${line}`.slice(-4000);
          }
        }
        newline = workerBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      if (worker !== child) return;
      workerErrors = `${workerErrors}${chunk}`.slice(-8000);
    });
    child.on("error", (error) => {
      if (worker === child) stop(error);
    });
    child.stdin.on("error", (error) => { if (worker === child) stop(error); });
    child.on("exit", (code) => {
      if (worker !== child) return;
      const error = new Error(`Voice output worker exited with code ${code}: ${workerErrors.trim()}`);
      stop(error);
    });
    return readyPromise;
  }

  async function speak(engine, text, { play = true } = {}) {
    if (speaking) throw new Error("Voice output is already speaking");
    speaking = true;
    const started = generation;
    try {
      const inventory = inspectVoiceOutputModels();
      if (!inventory.options.find((item) => item.id === engine)?.available && engine !== "xvasynth") {
        await ensureTtsRuntime(appRoot, inventory.voiceRoot, engine);
        if (started !== generation) throw new Error("Voice output cancelled");
      }
      const ready = ensureWorker(engine);
      const workerGeneration = generation;
      await ready;
      if (workerGeneration !== generation) throw new Error("Voice output cancelled");
      const id = `voice-${Date.now()}-${++requestSeq}`;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          stop(new Error(`${engine} voice output timed out`));
        }, speechTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        worker.stdin.write(`${JSON.stringify({ id, type: "speak", text, play })}\n`);
      });
    } finally {
      speaking = false;
    }
  }

  return { speak, stop, inspect: inspectVoiceOutputModels };
}

module.exports = {
  ALLOWED_VOICE_OUTPUT_MODELS,
  createVoiceOutputManager,
  inspectVoiceOutputModels,
};
