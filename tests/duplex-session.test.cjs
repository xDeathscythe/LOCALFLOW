const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDuplexCleanup } = require('../host/duplex-cleanup.cjs');
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
function createTransport() {
  liveWindows++;let closed=false;
  return {async call(method) { if(method==='offer')return 'v=0';if(method==='result'){if(hold)return new Promise((_,reject)=>{waiting=reject;});return outputs.shift();}}, async close(){if(closed)return;closed=true;liveWindows--;waiting?.(new Error('Closed'));waiting=null;} };
}
(async () => {
  const manager = createDuplexCleanup({ createTransport, Client, binary: () => '', directory: process.cwd() });
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
