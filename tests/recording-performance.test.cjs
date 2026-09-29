const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const output = path.resolve(__dirname, "../runtime/performance-check");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", fs.mkdtempSync(path.join(output, "browser-")));
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (!(await check())) {
    assert(Date.now() < deadline, `Timed out: ${label}`);
    await delay(20);
  }
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false, width: 1260, height: 900,
    webPreferences: { preload: path.join(__dirname, "settings-ui-preload.cjs"), backgroundThrottling: false },
  });
  let state = {};
  let saves = 0;
  ipcMain.on("test-recording-state", (_event, next) => { state = next; });
  ipcMain.handle("test-save-audio", (_event, payload) => {
    assert(payload.buffer.byteLength > 0, "Must preserve recorded audio");
    saves++;
    return "test.webm";
  });
  await window.loadFile(path.resolve(__dirname, "../dist/index.html"));
  const run = (script) => window.webContents.executeJavaScript(script);
  await until(() => run("Boolean(document.querySelector('[aria-label=Record]'))"), "UI ready");
  await run(`
    window.micDelay = 5000;
    window.micCalls = 0;
    window.micStreams = [];
    window.rejectMic = false;
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      window.micCalls++;
      await new Promise(resolve => setTimeout(resolve, window.micDelay));
      if (window.rejectMic) throw new Error('Test microphone denied');
      const stream = await originalCapture(...args);
      window.micStreams.push(stream);
      return stream;
    };
    window.waveFrames = 0;
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function(...args) {
      window.waveFrames++;
      return originalFill.apply(this, args);
    };
    void 0;
  `);
  const hotkey = (event, action = "dictation") => window.webContents.send("test-hotkey", { type: "hotkey", event, action });
  window.webContents.send("test-visibility", false);
  const started = Date.now();
  hotkey("pressed");
  await until(() => state.starting, "Immediate microphone feedback");
  const feedbackMs = Date.now() - started;
  assert(feedbackMs < 500, `Feedback took ${feedbackMs}ms`);
  assert(!state.recording, "Do not claim audio capture before microphone opens");
  hotkey("pressed");
  await delay(100);
  assert.equal(await run("window.micCalls"), 1, "Ignore duplicate start while acquiring microphone");
  hotkey("released");
  await until(() => saves === 1 && !state.recording && !state.starting, "Early release finishes exactly one recording");
  assert(await run("window.micStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))"));

  await run("window.micDelay = 0");
  hotkey("pressed");
  await until(() => state.recording, "Second capture starts");
  await delay(100);
  const hiddenFrames = await run("window.waveFrames");
  await delay(1000);
  assert.equal(await run("window.waveFrames"), hiddenFrames, "No hidden waveform animation");
  window.webContents.send("test-visibility", true);
  await delay(200);
  const visibleStart = await run("window.waveFrames");
  await delay(1000);
  const visibleFrames = (await run("window.waveFrames")) - visibleStart;
  assert(visibleFrames > 0 && visibleFrames <= 32, `Canvas frame rate: ${visibleFrames}`);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "recording.png"), (await window.webContents.capturePage()).toPNG());
  hotkey("released");
  await until(() => saves === 2 && !state.recording, "Normal hold release");

  await run("window.micDelay = 500");
  hotkey("pressed");
  await until(() => state.starting, "Cancelable startup");
  hotkey("pressed", "reset-session");
  await until(() => !state.starting, "Reset hides pending recording");
  await delay(1000);
  assert.equal(saves, 2, "Reset must not submit late audio");
  assert(await run("window.micStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))"));

  await run("window.rejectMic = true; window.micDelay = 0");
  hotkey("pressed");
  await until(() => run("document.body.textContent.includes('Test microphone denied')"), "Permission error displayed");
  await until(() => !state.recording && !state.starting, "Error hides overlay");
  assert.equal(saves, 2);

  await run("window.rejectMic = false; localStorage.setItem('localflow.hotkey-mode.v1', 'press')");
  await new Promise((resolve) => {
    window.webContents.once("did-finish-load", resolve);
    window.reload();
  });
  await until(() => run("Boolean(document.querySelector('[aria-label=Record]'))"), "Press-mode reload");
  hotkey("pressed");
  await until(() => state.recording, "Press mode starts");
  hotkey("released");
  await delay(800);
  assert(state.recording, "Press mode must survive release");
  hotkey("pressed");
  await until(() => saves === 3 && !state.recording, "Second press stops");
  const result = { feedbackMs, simulatedMicrophoneDelayMs: 5000, hiddenWaveformFrames: 0, visibleFramesPerSecond: visibleFrames, checks: "hold, press, duplicate start, early release, reset, denied microphone, track cleanup" };
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
