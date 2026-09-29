const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const childProcess = require("node:child_process");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "runtime", "latency-check");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", fs.mkdtempSync(path.join(output, "profile-")));
const commands = [];
childProcess.spawn = () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({ write(data, _encoding, callback) {
    commands.push(JSON.parse(data.toString()));
    callback();
  } });
  return child;
};
const replace = (name, exports) => {
  const id = require.resolve(`../electron/${name}.cjs`);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let authChecks = 0;
let warmups = 0;
let voiceResolve;
let voiceReject;
replace("voice-output", {
  ALLOWED_VOICE_OUTPUT_MODELS: new Set(["piper"]),
  createVoiceOutputManager: () => ({
    inspect: () => ({ options: [] }), stop() {},
    speak: () => new Promise((resolve, reject) => { voiceResolve = resolve; voiceReject = reject; }),
  }),
});
replace("cleanup-auth", { createCleanupAuthManager: () => ({
  inspect: async () => { authChecks++; return { connected: false, stage: "idle" }; }, cancel() {},
}) });
replace("transcription-worker", { createTranscriptionWorker: () => ({
  send: async (action) => { if (action === "warmup") warmups++; }, stop() {},
}) });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (!(await check())) {
    assert(Date.now() < deadline, `Timed out: ${label}`);
    await delay(25);
  }
}

require("../electron/main.cjs");
app.whenReady().then(async () => {
  await until(() => BrowserWindow.getAllWindows().length, "window without connecting Niwa");
  const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'LocalFlow');
  const run = (code) => window.webContents.executeJavaScript(code);
  await until(() => run("Boolean(document.querySelector('[aria-label=Record]'))"), "usable UI without connecting Niwa");
  await until(() => warmups > 0, "Whisper warmup without connecting Niwa");
  await run("localStorage.setItem('localflow.cleanup-level.v1', 'none')");
  authChecks = 0;
  window.reload();
  await until(() => run("Boolean(document.querySelector('[aria-label=Record]'))"), "cleanup-disabled reload");
  await delay(200);
  assert.equal(authChecks, 0, "Disabled cleanup must not even start a Codex login-status process");
  await run("document.querySelector('[data-section=niwa]').click()");
  await until(() => run("Boolean(document.querySelector('.niwaComposer textarea'))"), "Niwa ready without model load");
  const panel = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'LocalFlow Edge');
  await run("document.querySelector('[data-section=notes]').click()");
  await until(() => panel.webContents.executeJavaScript("document.querySelector('.controls').dataset.target === 'notes'"), 'Notes selection reaches native edge panel');
  await run("window.localflow.setEdgeSettings({enabled:false,autoHide:true})");
  window.hide();
  await run("window.localflow.setRecordingOverlayState({recording:true,elapsedSeconds:7})");
  assert.equal(await panel.webContents.executeJavaScript("document.querySelector('.controls').dataset.target"), 'notes', 'timer update preserves current edge selection');
  await until(() => commands.some(command => command.visible === true && command.elapsedSeconds === 7), "original recording overlay");
  await run("window.localflow.setEdgeSettings({enabled:true,autoHide:true})");
  await until(() => commands.at(-1)?.visible === false, "old overlay hidden when edge enabled");
  await run("window.localflow.setRecordingOverlayState({recording:false,elapsedSeconds:0})");
  console.log(JSON.stringify({ startupIndependentOfAgent:true, disabledCleanupAuthChecks:authChecks, legacyOverlayFallback:true }));
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
