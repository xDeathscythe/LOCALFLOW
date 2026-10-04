import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import codex from '../host/codex-client.cjs';
import { createNiwaAgent } from '../host/niwa-agent.mjs';

const directory = mkdtempSync(resolve('runtime/niwa-access-'));
const originalHome = process.env.CODEX_HOME, OriginalClient = codex.CodexClient;
writeFileSync(join(directory, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'test-only-unused' }));
process.env.CODEX_HOME = directory;
let client;
codex.CodexClient = class extends EventEmitter {
  constructor() { super(); client = this; this.calls = []; this.responses = []; }
  async initialize() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'model/list') return { data: [{ model: 'test', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }] }] };
    return { thread: { id: 'test-thread' } };
  }
  respond(id, result) { this.responses.push({ id, result }); }
  close() { this.closed = true; }
};
const agent = createNiwaAgent({ directory, appRoot: resolve('.'), binary: () => '', notify: () => {}, speak: async () => {} });
try {
  for (const access of ['full', 'workspace', 'read', 'full']) {
    await agent.configure({ access });
    await agent.connect();
    const calls = client.calls.filter(call => ['thread/start', 'thread/resume', 'thread/settings/update'].includes(call.method));
    assert.equal(calls.length, 2);
    assert(calls.every(call => call.params.approvalPolicy === (access === 'full' ? 'never' : 'on-request')));
    assert.equal(calls[1].params.sandboxPolicy.type, access === 'full' ? 'dangerFullAccess' : access === 'read' ? 'readOnly' : 'workspaceWrite');
    for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']) {
      client.emit('request', { id: method, method, params: { itemId: 'test', command: 'test-only' } });
      if (access === 'full') assert.equal(agent.snapshot().approvals.length, 0);
      else {
        assert.equal(agent.snapshot().approvals.length, 1, 'restricted access still asks');
        agent.respond(agent.snapshot().approvals[0].id, false);
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(client.responses.at(-1).result.decision, access === 'full' ? 'accept' : 'decline');
    }
  }
  console.log('NIWA_FULL_ACCESS_START_RESUME_APPROVALS_OK');
} finally {
  await agent.close(); codex.CodexClient = OriginalClient;
  if (originalHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalHome;
}
