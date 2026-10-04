import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const methods = ['list', 'read', 'trash', 'restore', 'history', 'restoreVersion', 'importLegacy', 'create', 'save', 'remove', 'rename', 'move', 'duplicate', 'databaseRead', 'databasePage', 'databasePatch', 'databasePageAction', 'databaseOptions', 'databaseExport', 'databaseSave', 'databaseQuery', 'databaseRunButton', 'databaseAddRow', 'databaseMoveRow', 'importBundle'];

if (!isMainThread) {
  const { createNotesStore } = await import('./notes-store.mjs');
  let changes = [];
  const store = createNotesStore(workerData.directory, change => changes.push(change));
  parentPort.on('message', ({ id, method, args }) => {
    try {
      if (method === 'close') { parentPort.postMessage({ id, value: true }); parentPort.close(); return; }
      if (!methods.includes(method)) throw new Error('Unknown notes operation.');
      // One worker processes complete operations in order, including revision checks.
      const value = store[method](...args);
      parentPort.postMessage({ id, value });
    } catch (error) { parentPort.postMessage({ id, error: error.message }); }
    finally {
      if (changes.length) parentPort.postMessage({ changed: { tree: changes.some(change => change.tree), ids: [...new Set(changes.flatMap(change => change.ids))] } });
      changes = [];
    }
  });
}

export function createNotesService(directory, changed) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { directory } });
  let sequence = 0, closed = false, failure, closing;
  const pending = new Map();
  const fail = error => { failure = error; for (const request of pending.values()) request.reject(error); pending.clear(); };
  worker.on('error', fail);
  worker.on('exit', () => { if (!closed || pending.size) fail(new Error('Notes worker stopped.')); });
  worker.on('message', message => {
    if (message.changed) { changed(message.changed); return; }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error)); else request.resolve(message.value);
  });
  const send = (method, args) => {
    if (failure || closed) return Promise.reject(failure || new Error('Notes are closed.'));
    return new Promise((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, method, args }); } catch (error) { pending.delete(id); reject(error); }
    });
  };
  return {
    ...Object.fromEntries(methods.map(method => [method, (...args) => send(method, args)])),
    close: () => {
      if (!closing) { closing = send('close', []).finally(() => worker.terminate()); closed = true; }
      return closing;
    },
  };
}
