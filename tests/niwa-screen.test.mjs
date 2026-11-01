import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import codex from '../host/codex-client.cjs';
import { createNiwaAgent } from '../host/niwa-agent.mjs';
import { screenVisionResult } from '../host/niwa/screen-vision.mjs';

let captures=0;
const captureScreen=async (_native,params={},signal)=>{signal?.throwIfAborted();return {content:[{type:'text',text:JSON.stringify({capturedAt:Date.now()})},{type:'image',mimeType:'image/jpeg',data:Buffer.from('fixture-'+(++captures)).toString('base64')}]};};
const native={};
const first=await captureScreen(native);

const catalog = [
  { model: 'text-model', inputModalities: ['text'], defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
  { model: 'vision-model', inputModalities: ['text', 'image'], isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
];
class FakeClient extends EventEmitter {
  static current;
  constructor() { super(); FakeClient.current = this; this.calls = []; this.responses = new Map(); this.visionCount = 0; }
  async initialize() {}
  async request(method, params = {}) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: {} };
    if (method === 'model/list') return { data: catalog };
    if (method === 'thread/start') return { thread: { id: params.ephemeral ? `vision-${++this.visionCount}` : 'owner' } };
    if (method === 'thread/resume') return { thread: { id: 'owner' } };
    if (method === 'thread/realtime/start') this.emit('notification', { method: 'thread/realtime/started', params: { threadId: 'owner' } });
    if (method === 'turn/start') {
      assert(params.input.some(item => item.type === 'image' && item.url.startsWith('data:image/jpeg;base64,')));
      if (!this.holdVision) queueMicrotask(() => this.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'v-turn', status: 'completed', items: [{ id: 'observation', type: 'agentMessage', text: 'A player is beside a doorway.' }] } } }));
      return { turn: { id: 'v-turn' } };
    }
    return {};
  }
  respond(id, result) { this.responses.set(id, result); }
  reject(id, message) { this.respond(id, { success: false, error: message }); }
  close() { this.closed = true; }
}
const originalClient = codex.CodexClient;
codex.CodexClient = FakeClient;
const directory = mkdtempSync(join(tmpdir(), 'localflow-screen-test-'));
const events = [];
const options = { directory, appRoot: resolve('.'), binary: () => '', notify: event => events.push(event), speak: async () => {}, captureScreen: (params, signal) => captureScreen(native, params, signal) };
let agent;
try {
  agent = createNiwaAgent(options);
  await agent.configure({ access: 'read' });
  await agent.startVoice('v=0\r\n');
  let client = FakeClient.current;
  assert(client.calls.find(call => call.method === 'thread/realtime/start').params.prompt.includes('fresh screen inspection'));
  const call = async (id, args) => {
    client.emit('request', { id, method: 'item/tool/call', params: { threadId: 'owner', tool: 'computer_use', callId: id, arguments: args } });
    for (let attempt = 0; !client.responses.has(id) && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    assert(client.responses.has(id), 'Tool request completed');
    return client.responses.get(id);
  };
  const image = await call('image', { action: 'screenshot' });
  assert.equal(image.success, true);
  assert(image.contentItems.some(item => item.type === 'inputImage'));
  assert.equal(agent.snapshot().voice, true, 'Screen inspection preserves voice session');
  assert.equal(events.filter(event => event.type === 'approval').length, 0, 'Screen viewing does not request control permission');
  assert.equal((await call('click', { action: 'click', x: 10, y: 20 })).success, false, 'Viewing never grants input control');
  await agent.stopVoice();
  await agent.configure({ model: 'text-model' });
  await agent.close();
  agent = createNiwaAgent(options);
  await agent.startVoice('v=0\r\n');
  client = FakeClient.current;
  assert(client.calls.some(call => call.method === 'thread/resume'), 'Existing conversations gain screen instructions without losing history');
  const described = await call('described', { action: 'screenshot', text: 'Šta vidiš?' });
  assert.equal(described.success, true);
  assert(!described.contentItems.some(item => item.type === 'inputImage'), 'Text-only owner receives a vision description');
  assert.match(described.contentItems[0].text, /doorway/);
  assert.equal(agent.snapshot().voice, true);
  const visionStart = client.calls.find(call => call.method === 'thread/start' && call.params.ephemeral);
  assert.equal(visionStart.params.model, 'vision-model');
  assert.equal(visionStart.params.sandbox, 'read-only');
  assert(!JSON.stringify(visionStart.params).includes('LOCALFLOW_MEMORY_DATA'), 'Vision worker receives no private memory');
  assert(client.calls.some(call => call.method === 'thread/unsubscribe'));
  assert(!client.calls.some(call => call.method === 'thread/realtime/stop'), 'Delegation does not stop the call');
  await assert.rejects(screenVisionResult(client, [catalog[0]], 'text-model', first, '', '.', undefined), /No image-capable/);
  client.holdVision = true;
  const controller = new AbortController();
  const pending = screenVisionResult(client, catalog, 'text-model', first, '', '.', controller.signal);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /cancelled/);
  assert(client.calls.some(call => call.method === 'turn/interrupt'));
  assert.equal(client.listenerCount('notification'), 1, 'Cancelled vision listener removed; owner listener retained');
  console.log('NIWA_SCREEN_OK: realtime vision routing, text-only delegation, resumed sessions, cancellation, voice preserved, no input-control grant; native frame capture checked by test:native');
} finally {
  await agent?.close(); codex.CodexClient = originalClient;
}
