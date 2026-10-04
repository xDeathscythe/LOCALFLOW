const { randomUUID } = require("node:crypto");

function createPasteHandler({ clipboard, getWorker, timeoutMs = 3000 }) {
  let busy = false;
  return async function pasteText(text) {
    if (typeof text !== "string" || !text.trim()) return false;
    if (busy) throw new Error("A paste is already in progress");
    const worker = getWorker();
    if (!worker?.stdin.writable) throw new Error("Keyboard helper is unavailable");
    busy = true;
    try {
      return await new Promise((resolve, reject) => {
        const id = randomUUID();
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          worker.off("paste-result", onResult);
          worker.off("exit", onExit);
          worker.off("error", finish);
          if (error) reject(error);
          else resolve(true);
        };
        const onResult = (result) => {
          if (result.id === id) finish(result.ok ? null : new Error(result.error || "Paste failed"));
        };
        const onExit = () => finish(new Error("Keyboard helper stopped before paste completed"));
        const timer = setTimeout(() => finish(new Error("Paste timed out")), timeoutMs);
        worker.on("paste-result", onResult);
        worker.once("exit", onExit);
        worker.once("error", finish);
        const send = () => { if (!settled) worker.stdin.write(`${JSON.stringify({ type: "paste", id })}\n`, error => { if(error)finish(error); }); };
        try {
          const result = clipboard.writeText(text);
          if (result?.then) result.then(send,finish); else send();
        } catch(error) { finish(error); }
      });
    } finally {
      busy = false;
    }
  };
}

module.exports = { createPasteHandler };
