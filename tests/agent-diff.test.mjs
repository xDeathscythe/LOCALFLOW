import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import codex from '../host/codex-client.cjs';
import { createNiwaAgent } from '../host/niwa-agent.mjs';
class Client extends EventEmitter {
  static current;
  constructor() { super(); Client.current = this; }
  async initialize() {}
  async request(method) {
    if (method === 'account/read') return { account: {} };
    if (method === 'model/list') return { data: [{ model: 'test', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] };
    if (['thread/start', 'thread/resume'].includes(method)) return { thread: { id: 'owner' } };
    return {};
  }
  close() { this.closed = true; }
}
const original = codex.CodexClient;
codex.CodexClient = Client;
const events = [];
const options = { directory: mkdtempSync(join(tmpdir(), 'localflow-diff-')), appRoot: resolve('.'), binary: () => '', notify: event => events.push(event), speak: async () => {} };
let agent = createNiwaAgent(options);
try {
  await agent.connect();
  const emit = (method, params) => Client.current.emit('notification', { method, params });
  const diff = '--- a/日本語.txt\n+++ b/日本語.txt\n-旧\n+新';
  emit('turn/diff/updated', { threadId: 'other', diff: 'unrelated' });
  assert.equal(agent.snapshot().diff, '');
  emit('turn/diff/updated', { threadId: 'owner', diff });
  assert.equal(agent.snapshot().diff, diff);
  assert.deepEqual(events.at(-1), { type: 'diff', diff });
  await agent.close(); agent = createNiwaAgent(options);
  assert.equal(agent.snapshot().diff, diff, 'Diff survives reload');
  await agent.connect();
  emit('turn/started', { threadId: 'owner', turn: { id: 'next' } });
  await agent.close(); agent = createNiwaAgent(options);
  assert.equal(agent.snapshot().diff, '');
  console.log('AGENT_DIFF_OK: scoped events, Unicode, persistence, next-turn reset');
} finally { await agent.close(); codex.CodexClient = original; }
