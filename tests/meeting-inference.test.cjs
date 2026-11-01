const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = require('../host/runtime-config.cjs');
const { createTranscriptionWorker } = require('../host/transcription-worker.cjs');

runtime.loadDotEnv(); runtime.ensureRuntimeEnv();
// A small existing local model avoids competing with the owner's live GPU model.
process.env.LOCALFLOW_WHISPER_MODEL = 'base';
process.env.LOCALFLOW_WHISPER_DEVICE = 'cpu';
process.env.LOCALFLOW_WHISPER_COMPUTE_TYPE = 'int8';
process.env.LOCALFLOW_WHISPER_LANGUAGE = 'sr';
const worker = createTranscriptionWorker({ python: runtime.resolvePython(), script: path.resolve('backend/worker.py'), cwd: path.resolve('.'), notify() {}, cleanup() { throw new Error('Meeting ASR must not call cleanup.'); }, timeoutMs: 120000 });
(async () => {
  try {
    for (const source of ['microphone', 'remote']) {
      const result = await worker.send('transcribe', { path: path.resolve('tests/fixtures/dictation.wav'), options: { transcriptOnly: true, language: 'auto' } }, `meeting:inference:${source}`, { owner: 'meeting' });
      assert.match(result.rawText.toLowerCase(), /orange bicycle/); assert.match(result.rawText.toLowerCase(), /library/);
      assert.equal(result.polishedText, ''); assert.equal(result.language, 'en');
      assert(result.segments.length && result.segments.every(segment => segment.start >= 0 && segment.end > segment.start));
    }
    console.log('MEETING_REAL_ASR_OK: both source jobs, existing local base model, CPU int8, English audio despite Serbian dictation setting, timed raw transcript without cleanup');
  } finally { worker.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
