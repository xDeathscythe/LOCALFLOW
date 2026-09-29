const assert = require('node:assert/strict');
const { parseCleanup } = require('../electron/duplex-cleanup.cjs');
const { LIVE_MODEL, LIVE_VOICES } = require('../electron/realtime-config.cjs');
const { createTranscriptionWorker } = require('../electron/transcription-worker.cjs');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const value = { action: 'translate', target_language: 'ja', text: '今日は良い天気です。' };
assert.deepEqual(parseCleanup('{"action":"translate","target_language":"ja"}\n' + value.text), value);
assert.throws(() => parseCleanup('{"action":"partial"'), /invalid cleanup header/);
assert.throws(() => parseCleanup('{"action":"dictate","target_language":null}'), /no cleaned text/);
assert.throws(() => parseCleanup('{"action":"execute","text":"bad","target_language":null}'), /invalid cleanup result/);
assert.equal(LIVE_MODEL, 'gpt-live-1-codex');
assert(!LIVE_VOICES.includes('shimmer'));
const directory = mkdtempSync(join(tmpdir(), 'duplex-worker-test-'));
const script = join(directory, 'worker.cjs');
writeFileSync(script, `let id; require('node:readline').createInterface({input:process.stdin}).on('line', line=>{
 const p=JSON.parse(line);
 if(p.type==='cleanup-result') console.log(JSON.stringify({id,type:'result',ok:p.ok,data:p.data,error:p.error}));
 else {id=p.id;console.log(JSON.stringify({id:'cleanup',type:'cleanup-request',prompt:p.params.prompt,timeout:10}));}
});`);
(async () => {
  let abortSeen = false;
  const worker = createTranscriptionWorker({ python: { command: process.execPath, args: [] }, script, cwd: directory, notify: () => {}, cleanup: async ({ prompt }, signal) => {
    if (prompt === 'cancel') return new Promise((_, reject) => signal.addEventListener('abort', () => { abortSeen = true; reject(new Error('cancelled')); }, { once: true }));
    return value;
  } });
  try {
    assert.deepEqual(await worker.send('transcribe', { prompt: '日本語' }), value);
    const cancelled = assert.rejects(worker.send('transcribe', { prompt: 'cancel' }), /cancelled/);
    await new Promise(resolve => setTimeout(resolve, 100)); worker.stop(); await cancelled;
    assert(abortSeen, 'Cancelling dictation closes its independent Live1 cleanup');
    assert.deepEqual(await worker.send('transcribe', { prompt: 'again' }), value);
    console.log('DUPLEX_CLEANUP_OK: strict JSON, supported voices, worker bridge, cancellation and recovery');
  } finally { worker.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
