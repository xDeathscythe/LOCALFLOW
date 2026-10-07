const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { mock } = require("node:test");
const { createTranscriptionWorker } = require("../host/transcription-worker.cjs");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localflow-worker-"));
  const script = path.join(dir, "worker.cjs");
  fs.writeFileSync(script, `
    require('readline').createInterface({input: process.stdin}).on('line', line => {
      const {id, action, params} = JSON.parse(line);
      if(action === 'exit') process.exit(7);
      if(action === 'cancel') return;
      console.log(JSON.stringify({id, type:'progress', stage:'started'}));
      setTimeout(() => console.log(JSON.stringify({id, type:'result', ok:true, data:{pid:process.pid, ...params}})), params.delay || 0);
    });
  `);
  const events = [];
  const options = { python: { command: process.execPath, args: [] }, script, cwd: dir, notify: (event) => events.push(event) };
  const worker = createTranscriptionWorker(options);
  const timed = createTranscriptionWorker({ ...options, timeoutMs: 300 });
  try {
    const first = await worker.send("warmup");
    assert.equal((await worker.send("configure", { language: "en" })).pid, first.pid);
    const cancelled = assert.rejects(worker.send("transcribe", { delay: 1000 }, "cancelled"), /cancelled/);
    worker.cancel();
    await cancelled;
    const recovered = await worker.send("transcribe", {}, "current");
    assert.equal(recovered.pid, first.pid, 'Cancellation keeps the model process alive');
    assert(events.some((event) => event.id === "current" && event.action === "transcribe"));
    const meeting = worker.send('transcribe', { delay: 30 }, 'meeting-job', { owner: 'meeting' });
    const dictation = assert.rejects(worker.send('transcribe', { delay: 30 }, 'dictation-job'), /cancelled/);
    worker.cancel(); await dictation;
    assert.equal((await meeting).pid, first.pid, 'Cancelling dictation preserves a concurrent meeting job');
    const scoped = assert.rejects(worker.send('transcribe', { delay: 1000 }, 'meeting-cancel', { owner: 'meeting' }), /cancelled/);
    worker.cancel('meeting-cancel'); await scoped;
    await assert.rejects(worker.send("exit"), /exited/);
    await worker.send("warmup");
    await assert.rejects(timed.send("transcribe", { delay: 2000 }), /timed out/);
    await timed.send("warmup");
    const missing = createTranscriptionWorker({ ...options, python: { command: path.join(dir, "missing.exe"), args: [] } });
    await assert.rejects(missing.send("warmup"), /ENOENT/);
    missing.stop();
    worker.stop();
    mock.timers.enable({ apis: ["setTimeout"] });
    const idleFirst = await worker.send("warmup");
    mock.timers.tick(10 * 60 * 1000);
    const idleNext = await worker.send("transcribe");
    assert.equal(idleNext.pid, idleFirst.pid, "A pause must not discard the loaded model");
    mock.timers.reset();
    console.log("Worker reuse, cancellation, timeout, crash and spawn recovery passed");
  } finally {
    mock.timers.reset();
    worker.stop();
    timed.stop();
    // Keep the tiny temporary script until asynchronous Windows process termination finishes.
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
