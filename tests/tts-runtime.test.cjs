const assert = require("assert");
const path = require("path");
const {
  resolveTtsRoot,
  ttsRuntimeReady,
} = require("../electron/tts-runtime.cjs");

const appRoot = path.resolve(__dirname, "..");
const previousRoot = process.env.LOCALFLOW_VOICE_ROOT;

try {
  process.env.LOCALFLOW_VOICE_ROOT = "runtime\\tts";
  assert.strictEqual(resolveTtsRoot(appRoot, false, "ignored"), path.join(appRoot, "runtime", "tts"));
  delete process.env.LOCALFLOW_VOICE_ROOT;
  assert.strictEqual(
    resolveTtsRoot("C:\\Program Files\\LocalFlow\\resources\\app.asar", true, "C:\\Users\\Test\\AppData\\Local"),
    "C:\\Program Files\\LocalFlow\\resources\\runtime\\tts",
  );
  assert.strictEqual(ttsRuntimeReady(path.join(appRoot, "runtime", "tts")), true);
  console.log("TTS runtime path and readiness checks passed.");
} finally {
  if (previousRoot === undefined) delete process.env.LOCALFLOW_VOICE_ROOT;
  else process.env.LOCALFLOW_VOICE_ROOT = previousRoot;
}
