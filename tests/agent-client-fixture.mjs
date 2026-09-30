import { EventEmitter } from 'node:events';
export class TestClient extends EventEmitter {
  static current; static count = 0;
  constructor() { super(); TestClient.current = this; this.calls = []; this.threadId = `test-${++TestClient.count}`; }
  async initialize() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: {} };
    if (method === 'model/list') return { data: [{ model: 'test-model', displayName: 'Test model', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }] };
    if (method === 'thread/start') return { thread: { id: this.threadId } };
    if (method === 'thread/resume') { this.threadId = params.threadId; return { thread: { id: this.threadId } }; }
    if (method === 'turn/start') return { turn: { id: 'turn-test' } };
    return {};
  }
  respond(id, result) { this.response = { id, result }; }
  reject(id, message) { throw new Error(message); }
  notify(method, params = {}) { this.emit('notification', { method, params: { threadId: this.threadId, ...params } }); }
  close() { this.closed = true; }
}
