const { spawn } = require("child_process");
const { createInterface } = require("readline");
const { terminateProcess } = require("./child-process.cjs");

function createTranscriptionWorker({ python, script, cwd, notify, cleanup, timeoutMs = 30 * 60 * 1000 }) {
  // Keep the loaded model across cancellation; only failures and app exit terminate it.
  let worker = null;
  let sequence = 0;
  const pending = new Map();
  const cleanups = new Map();

  function settle(id, error, data) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve(data);
  }

  function stop(error = Object.assign(new Error("Transcription cancelled"), { code: "CANCELLED" })) {
    for (const controller of cleanups.values()) controller.abort();
    cleanups.clear();
    const previous = worker;
    worker = null;
    for (const id of pending.keys()) settle(id, error);
    terminateProcess(previous);
  }

  function ensureWorker() {
    if (worker) return worker;
    const child = spawn(python.command, [...python.args, script], {
      cwd, env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    worker = child;
    let stderr = "";
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (worker !== child) return;
      let payload;
      try { payload = JSON.parse(line); } catch { return; }
      if (payload.type === 'cleanup-request') {
        const controller = new AbortController();
        cleanups.set(payload.jobId || payload.id, controller);
        Promise.resolve().then(() => {
          if (!cleanup) throw new Error('Live1 cleanup is unavailable.');
          return cleanup(payload, controller.signal);
        }).then(data => ({ ok: true, data }), error => ({ ok: false, error: error.message })).then(result => {
          if (worker === child && child.stdin.writable) child.stdin.write(JSON.stringify({ type: 'cleanup-result', id: payload.id, ...result }) + '\n');
          cleanups.delete(payload.jobId || payload.id);
        });
        return;
      }
      if (payload.type === "ready") {
        notify(payload);
        return;
      }
      const request = pending.get(payload.id);
      if (!request || request.worker !== child) return;
      if (payload.type === "result") {
        settle(payload.id, payload.ok ? null : new Error(payload.error || "Transcription failed"), payload.data);
      } else {
        notify({ ...payload, action: request.action });
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    const failed = (error) => {
      if (worker === child) stop(error);
      lines.close();
    };
    child.on("error", failed);
    child.stdin.on("error", failed);
    child.on("close", (code) => failed(new Error(`Local worker exited (${code}): ${stderr.trim()}`)));
    return child;
  }

  function send(action, params = {}, requestId, { owner = 'dictation' } = {}) {
    const child = ensureWorker();
    const id = requestId || `worker-${++sequence}`;
    if (pending.has(id)) return Promise.reject(new Error("Duplicate transcription request"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (action === 'transcribe') cancelRequest(id, new Error('Local transcription timed out'));
        else stop(new Error('Local transcription timed out'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, action, owner, worker: child });
      child.stdin.write(`${JSON.stringify({ id, action, params })}\n`, "utf8", (error) => {
        if (error && worker === child) stop(error);
      });
    });
  }

  function cancelRequest(id, error = Object.assign(new Error('Transcription cancelled'), { code: 'CANCELLED' })) {
    cleanups.get(id)?.abort(); cleanups.delete(id);
    if (worker?.stdin.writable) worker.stdin.write(JSON.stringify({ action: 'cancel', id }) + '\n');
    settle(id, error);
  }
  function cancel(requestId) {
    for (const [id, request] of pending) if (request.action === 'transcribe' && (requestId ? id === requestId : request.owner === 'dictation')) cancelRequest(id);
  }
  return { send, cancel, stop, isBusy: (owner = 'dictation') => [...pending.values()].some(request => request.action === 'transcribe' && request.owner === owner) };
}

module.exports = { createTranscriptionWorker };
