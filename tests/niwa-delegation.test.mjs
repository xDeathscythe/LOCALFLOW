import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import runtime from '../host/runtime-config.cjs';
import { createNiwaAgent } from '../host/niwa-agent.mjs';
const directory = resolve('runtime/niwa-delegation', String(Date.now()));
mkdirSync(directory, { recursive: true });
const events = [];
const agent = createNiwaAgent({ directory, appRoot: resolve('.'), binary: runtime.resolveNiwaCodexBinary, speak: async () => {}, notify: event => {
  events.push(event);
  if (['activity', 'error', 'approval'].includes(event.type)) console.log(JSON.stringify(event));
  if (event.type === 'approval') {
    const changes = JSON.parse(event.detail);
    const allowed = Array.isArray(changes) && changes.length === 1 && resolve(changes[0].path) === join(directory, 'niwa/workspace/proof.txt') && changes[0].diff.trim() === '437';
    agent.respond(event.id, allowed);
  }
} });
try {
  await agent.connect();
  await agent.send('This is an isolated integration test in your current workspace. Call skills_list and confirm systematic-debugging exists. Spawn exactly one Codex subagent to calculate 19 * 23 without tools. Wait for its result. Then use apply_patch to create proof.txt containing only the numeric result in the current workspace. Do not change any other files or run shell commands. Report DELEGATION_OK with the skill confirmation.');
  const until = Date.now() + 180_000;
  while (agent.snapshot().busy && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 250));
  assert(!agent.snapshot().busy, 'task completed');
  assert.equal(readFileSync(join(directory, 'niwa/workspace/proof.txt'), 'utf8').trim(), '437');
  assert(events.some(event => event.type === 'activity' && event.text === 'collabAgentToolCall'), 'native Codex subagent used');
  assert(events.some(event => event.type === 'activity' && event.text === 'skills_list'), 'owner agent used Niwa skill library');
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ delegation: true, workspaceWrite: true }));
  console.log('NIWA_SUBAGENT_WORKSPACE_WRITE_OK');
} finally { await agent.close(); }
