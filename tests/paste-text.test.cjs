const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createPasteHandler } = require("../electron/paste-text.cjs");

async function main() {
  const worker = new EventEmitter();
  let command;
  let callback;
  let clipboardText;
  worker.stdin = { writable: true, write(line, done) { command = JSON.parse(line); callback = done; } };
  const paste = createPasteHandler({ getWorker: () => worker, clipboard: { writeText(text) { clipboardText = text; } }, timeoutMs: 30 });
  assert.equal(await paste(" "), false);
  let pending = paste("日本語");
  await assert.rejects(paste("overlap"), /already in progress/);
  assert.equal(clipboardText, "日本語");
  worker.emit("paste-result", { id: "unrelated", ok: true });
  worker.emit("paste-result", { id: command.id, ok: true });
  assert.equal(await pending, true);
  pending = assert.rejects(paste("exit"), /helper stopped/);
  worker.emit("exit", 1);
  await pending;
  pending = assert.rejects(paste("write failure"), /broken pipe/);
  callback(new Error("broken pipe"));
  await pending;
  pending = assert.rejects(paste("native failure"), /Windows blocked input/);
  worker.emit("paste-result", { id: command.id, ok: false, error: "Windows blocked input" });
  await pending;
  await assert.rejects(paste("timeout"), /timed out/);
  assert.equal(worker.listenerCount("paste-result"), 0);
  assert.equal(worker.listenerCount("exit"), 0);
  assert.equal(worker.listenerCount("error"), 0);
  worker.stdin.writable = false;
  await assert.rejects(paste("unavailable"), /unavailable/);
  console.log("Paste acknowledgements, Unicode, overlap, timeout, exit and write failures passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
