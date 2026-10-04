const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createVoiceOutputManager } = require('../electron/voice-output.cjs');

const resources = path.resolve(process.argv[2]);
for (const file of ['voice_output_worker.py', 'voice_output_session.py']) {
  assert(fs.readFileSync(path.join(resources, 'backend', file)).equals(fs.readFileSync(path.resolve('backend', file))));
}
// Optional TTS runtimes are installed separately; use the existing test runtime.
process.env.LOCALFLOW_VOICE_ROOT = path.resolve('runtime/tts');
process.env.LOCALFLOW_VOICE_OUTPUT_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localflow-packaged-tts-')), 'output');
const voice = createVoiceOutputManager(resources);
(async () => {
  try {
    const first = await voice.speak('piper', 'Packaged speech is ready.', { play: false });
    const second = await voice.speak('piper', 'The model stays warm.', { play: false });
    assert.equal(first.workerPid, second.workerPid);
    console.log('PACKAGED_TTS_PROTOCOL_AND_REUSE_OK', first.workerPid);
  } finally { voice.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
