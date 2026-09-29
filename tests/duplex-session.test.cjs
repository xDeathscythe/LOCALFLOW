const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDuplexCleanup } = require('../electron/duplex-cleanup.cjs');
let requests = [], outputs = [], hold = false, waiting, liveWindows = 0;
class Client extends EventEmitter {
  async initialize() {}
  async request(method, params) {
    requests.push({ method, params });
    if (method === 'thread/start') return { thread: { id: String(requests.length) } };
    return {};
  }
  close() { this.closed = true; }
}
class Window {
  constructor(options) {
    assert.equal(options.show, false); liveWindows++;
    this.webContents = { session: { setPermissionRequestHandler: handler => handler(null, 'media', allowed => assert.equal(allowed, false)) }, executeJavaScript: async script => {
      if (script.endsWith('offer()')) return 'v=0';
      if (script.endsWith('.result')) {
        if (hold) return new Promise((_, reject) => { waiting = reject; });
        return outputs.shift();
      }
    } };
  }
  async loadFile() {}
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; liveWindows--; waiting?.(new Error('Destroyed')); waiting = null; }
}
(async () => {
  const manager = createDuplexCleanup({ BrowserWindow: Window, Client, binary: () => '', directory: process.cwd() });
  outputs = ['malformed', '{"action":"dictate","target_language":null}\nValid cleanup.'];
  assert.equal((await manager.clean({ prompt: 'test' })).text, 'Valid cleanup.');
  assert.equal(requests.filter(r => r.method === 'thread/realtime/appendText').length, 2, 'One bounded format retry');
  assert.equal(liveWindows, 0);
  assert.equal(requests.find(r => r.method === 'thread/realtime/start').params.voice, 'juniper');
  hold = true;
  const controller = new AbortController();
  const cancelled = assert.rejects(manager.clean({ prompt: 'test' }, controller.signal), /cancelled/);
  while (!waiting) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(); await cancelled;
  assert.equal(liveWindows, 0, 'Cancellation closes the hidden cleanup connection');
  hold = false; outputs = ['{"action":"dictate","target_language":null}\nRecovered.'];
  assert.equal((await manager.clean({ prompt: 'test' })).text, 'Recovered.');
  manager.close();
  assert.equal(liveWindows, 0);
  console.log('DUPLEX_SESSION_OK: no media permissions, format retry, cancellation, resource cleanup and recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
