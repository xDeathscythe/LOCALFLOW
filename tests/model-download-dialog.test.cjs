const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const original = Module._load;
let response = 1;
const prompts = [];
Module._load = function (name, ...args) {
  return name === 'electron' ? { dialog: { showMessageBox: async options => { prompts.push(options); return { response }; } } } : original.call(this, name, ...args);
};
(async () => {
  const { confirmModelDownload } = require('../electron/model-download-dialog.cjs');
  const { ensureTtsRuntime } = require('../electron/tts-runtime.cjs');
  const root = fs.mkdtempSync(path.resolve('runtime/download-dialog-'));
  assert.equal(await confirmModelDownload('Whisper Small'), false);
  assert.deepEqual(prompts[0].buttons, ['Download this model', 'Cancel']);
  assert.equal(prompts[0].cancelId, 1);
  await assert.rejects(ensureTtsRuntime(root, root, 'piper'), /download cancelled/);
  assert.deepEqual(fs.readdirSync(root), [], 'Cancellation must not start an installer');
  response = 0;
  assert.equal(await confirmModelDownload('Whisper Small'), true);
  for (const name of ['piper/.venv/Scripts/python.exe', 'piper/voices/en_US-kristin-medium.onnx']) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
  }
  const count = prompts.length;
  assert.equal((await ensureTtsRuntime(root, root, 'piper')).installed, false);
  assert.equal(prompts.length, count, 'Installed voices must not ask to download again');
  console.log('MODEL_DOWNLOAD_CONFIRM_CANCEL_AND_TTS_CACHE_REUSE_OK');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = original; });
