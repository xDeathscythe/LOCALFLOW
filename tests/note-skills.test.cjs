const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { runNoteSkill } = require('../electron/notes/skills.cjs');
class Client extends EventEmitter {
  static current;
  constructor() { super(); Client.current = this; this.calls = []; }
  async initialize() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: {} };
    if (method === 'model/list') return { data: [{ model: 'fixture', isDefault: true, defaultReasoningEffort: 'low' }] };
    if (method === 'thread/start') return { thread: { id: 'writing' } };
    if (method === 'turn/start') { queueMicrotask(() => { this.emit('notification', { method: 'item/completed', params: { threadId: 'writing', item: { type: 'agentMessage', text: '日本語 العربية српски' } } }); this.emit('notification', { method: 'turn/completed', params: { threadId: 'writing', turn: { status: 'completed' } } }); }); return { turn: { id: 'turn' } }; }
  }
  close() { this.closed = true; }
}
(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'localflow-note-skills-')), config = { directory, binary: () => '', settings: {} };
  try {
    for (const skill of ['improve', 'proofread', 'explain', 'reformat', 'ask', 'suggest']) {
      const text = '日本語 العربية српски';
      assert.equal(await runNoteSkill(config, { skill, text, prompt: 'Keep this language' }, Client), text);
      const start = Client.current.calls.find(call => call.method === 'thread/start').params;
      assert.equal(start.sandbox, 'read-only'); assert.equal(start.ephemeral, true); assert.deepEqual(start.dynamicTools, []);
      assert.equal(start.config['features.shell_tool'], false); assert.equal(Client.current.closed, true);
      assert.equal(JSON.parse(Client.current.calls.find(call => call.method === 'turn/start').params.input[0].text).sourceText, text);
    }
    await assert.rejects(runNoteSkill(config, { skill: 'unknown', text: 'x' }, Client), /Invalid/);
    await assert.rejects(runNoteSkill(config, { skill: 'improve', text: 'x'.repeat(100001) }, Client), /Invalid/);
    class Disconnected extends Client { async request(method, params) { return method === 'account/read' ? { account: null } : super.request(method, params); } }
    await assert.rejects(runNoteSkill(config, { skill: 'improve', text: 'x' }, Disconnected), /Connect Codex/);
    assert.equal(Client.current.closed, true);
    console.log('NOTE_SKILLS_OK: six explicit operations, multilingual source, isolated read-only model, account errors and cleanup');
  } finally { rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
