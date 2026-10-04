const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { app, BrowserWindow } = require('electron');
const output = path.resolve('runtime/startup-check');
fs.mkdirSync(output, { recursive: true });
const directory = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', directory);
fs.writeFileSync(path.join(directory, 'edge-panel.json'), JSON.stringify({ enabled: false, autoHide: true }));
process.env.LOCALFLOW_DATA_DIR = path.join(directory, 'runtime');
process.env.LOCALFLOW_TEMP_DIR = path.join(directory, 'temp');
const started = performance.now();
let warmupAt, stopped = false;
// Exercise the real startup/UI; avoid a second GPU model or global hotkey hook.
require('../electron/transcription-worker.cjs').createTranscriptionWorker = () => ({
  send: async action => { assert.equal(action, 'warmup'); warmupAt ??= performance.now() - started; return {}; },
  stop: () => { stopped = true; },
});
const children = require('node:child_process'), spawn = children.spawn;
children.spawn = (command, args, options) => {
  if (!args?.some(arg => String(arg).endsWith('hotkey_watcher.py'))) return spawn(command, args, options);
  return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false });
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Startup timed out'); app.exit(1); }, 25000);
(async () => {
  const { TestClient } = await import('./agent-client-fixture.mjs');
  require('../electron/codex-client.cjs').CodexClient = TestClient;
  let main, createdAt;
  app.on('browser-window-created', (_event, window) => {
    if (!main) {
      main = window; createdAt = performance.now() - started;
      assert(!Object.keys(require.cache).some(file => file.includes('linkedom')), 'Asset registration must not load HTML importer before first window');
    }
    window.hide();
  });
  require('../electron/main.cjs');
  await app.whenReady();
  while (!main || main.webContents.isLoading() || !await main.webContents.executeJavaScript("Boolean(document.querySelector('[aria-label=\"Message Niwa\"]'))")) await pause(30);
  const readyAt = performance.now() - started;
  assert(warmupAt >= 0 && warmupAt < readyAt, 'VTT warmup begins immediately without waiting for UI');
  assert(!stopped, 'Startup preserves the warm VTT worker');
  const run = code => main.webContents.executeJavaScript(code);
  const assets = await run("performance.getEntriesByType('resource').map(item=>item.name)");
  assert(!assets.some(file => /\/(NotesPage|NoteEditor)-/.test(file)), 'Notes/editor chunks wait until first use');
  assert.equal(await run("document.querySelectorAll('.noteWorkspace').length"), 0);
  await run("document.querySelector('[data-section=notes]').click()");
  while (!await run("Boolean(document.querySelector('.noteWorkspace'))")) await pause(30);
  await run("document.querySelector('[data-section=niwa]').click()");
  assert.equal(await run("document.querySelectorAll('.noteWorkspace').length"), 1, 'Notes remains mounted after switching back to chat');
  const result = { mainWindowCreatedMs: createdAt, vttWarmupRequestedMs: warmupAt, agentUiReadyMs: readyAt, checks: 'real main startup, isolated profile, mocked GPU/hotkeys/Codex, lazy Notes' };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  clearTimeout(deadline);
  app.quit();
})().catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
