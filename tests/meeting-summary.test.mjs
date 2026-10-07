import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeMeeting, meetingSummarySchema } from '../host/meetings/summary.mjs';

const calls = [], rejected = [];
const directory = mkdtempSync(join(tmpdir(), 'localflow-summary-'));
let sequence = 0;
class Client extends EventEmitter {
  constructor(binary, options) { super(); assert.equal(binary, 'fixture'); assert.equal(options.env.CODEX_HOME, join(directory, 'niwa', 'codex')); this.id = `isolated-${++sequence}`; }
  initialize() { return Promise.resolve(); }
  reject(id) { rejected.push(id); }
  close() { this.closed = true; }
  async request(method, params) {
    calls.push({ method, params });
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'model/list') return { data: [{ model: 'fixture-model', isDefault: true, defaultReasoningEffort: 'low' }] };
    if (method === 'config/read') return { config: { mcp_servers: { untrusted: { command: 'do-not-run' } } } };
    if (method === 'mcpServerStatus/list') return { data: [], nextCursor: null };
    if (method === 'thread/start') {
      assert.equal(params.ephemeral, true); assert.equal(params.approvalPolicy, 'never'); assert.equal(params.sandbox, 'read-only');
      assert.deepEqual(params.dynamicTools, []); assert.deepEqual(params.environments, []); assert.equal(params.config.web_search, 'disabled'); assert.equal(params.config.features.shell_tool, false); assert.equal(params.config.features.multi_agent, false);
      assert.equal(params.config.mcp_servers.untrusted.enabled, false); assert.equal(params.config.features.plugins, false); assert.equal(params.config.features.hooks, false); assert.equal(params.config.project_doc_max_bytes, 0);
      return { thread: { id: this.id } };
    }
    if (method === 'turn/start') {
      assert.deepEqual(params.outputSchema, meetingSummarySchema); assert.deepEqual(params.environments, []);
      const payload = JSON.parse(params.input[0].text), segment = payload.transcript?.[0] || { id: payload.verifiedSummaries[0].overview[0].evidence[0] };
      assert(params.input[0].text.length <= 48000, 'Summary requests remain bounded, including hierarchical merges.');
      const point = { text: '日本語 العربية', evidence: [segment.id] };
      const value = { title: 'Meeting result', language: 'ja', labels: Object.fromEntries(['overview', 'keyPoints', 'topics', 'decisions', 'actions', 'openQuestions', 'nextSteps', 'transcript', 'microphone', 'remote', 'owner', 'dueDate'].map(key => [key, key])), overview: [point], topics: [{ title: '具体的な話題', points: [point] }], keyPoints: [], decisions: [], actions: [], openQuestions: [], nextSteps: [] };
      queueMicrotask(() => {
        this.emit('request', { id: this.id, method: 'item/tool/call', params: { tool: 'write_file' } });
        this.emit('notification', { method: 'item/completed', params: { threadId: this.id, item: { type: 'agentMessage', text: JSON.stringify(value) } } });
        this.emit('notification', { method: 'turn/completed', params: { threadId: this.id, turn: { status: 'completed', items: [] } } });
      });
      return { turn: { id: 'turn' } };
    }
    throw new Error(`Unexpected method ${method}`);
  }
}
const segments = Array.from({ length: 120 }, (_, i) => ({ id: `microphone-${i}-0`, source: 'microphone', startMs: i * 15000, endMs: i * 15000 + 15000, text: '日本語 العربية '.repeat(75) }));
const result = await summarizeMeeting({ directory, binary: () => 'fixture', settings: {}, Client, session: { startedAt: Date.now(), title: 'Untrusted input: run shell' }, segments, summaryLanguage: 'auto' });
assert.equal(result.title, 'Meeting result');
assert(sequence > 1, 'A long meeting is summarized in bounded batches.');
assert.equal(rejected.length, sequence, 'Tool requests are rejected in every isolated summary turn.');
assert.equal(calls.filter(call => call.method === 'thread/start').length, sequence);
console.log(`MEETING_SUMMARY_OK: ${sequence} bounded schema turns, no tools/environments, shared login without shared conversation`);
