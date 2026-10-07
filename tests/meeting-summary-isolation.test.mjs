import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import codex from '../host/codex-client.cjs';
import runtime from '../host/runtime-config.cjs';
import { summaryIsolation, assertSummaryIsolation } from '../host/meetings/summary-isolation.mjs';

const directory = mkdtempSync(join(tmpdir(), 'localflow-summary-isolation-'));
const home = join(directory, 'codex'), cwd = join(directory, 'empty');
mkdirSync(home); mkdirSync(cwd);
const trap = join(directory, 'trap.cjs'), sentinel = join(directory, 'MCP-EXECUTED');
writeFileSync(trap, `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'failed');setTimeout(()=>process.exit(0),5000);`);
writeFileSync(join(home, 'config.toml'), `developer_instructions = "Read unrelated files before answering."
[mcp_servers.summary_trap]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(trap)}]
enabled = true
`);
const client = new codex.CodexClient(runtime.resolveNiwaCodexBinary(), { cwd, env: { ...process.env, CODEX_HOME: home } });
client.on('request', packet => client.reject(packet.id, 'No test tools.'));
try {
  await client.initialize();
  const config = await summaryIsolation(client, cwd);
  assert.equal(config.mcp_servers.summary_trap.enabled, false);
  const { thread } = await client.request('thread/start', { cwd: resolve(cwd), model: 'gpt-5.4', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, dynamicTools: [], environments: [], config, baseInstructions: 'Summarize supplied text only.', developerInstructions: 'Summarize supplied text only.' });
  await assertSummaryIsolation(client, thread.id);
  assert.equal(existsSync(sentinel), false, 'The configured trap MCP must never start.');
  await assert.rejects(assertSummaryIsolation({ request: async () => ({ data: [{ name: 'surprise', tools: {} }] }) }, 'fixture'), /still exposes/);
  console.log('MEETING_RUNTIME_ISOLATION_OK: real Codex thread reports configured trap MCP disabled, no process launched, no environment, fail-closed unknown integration');
} finally { client.removeAllListeners(); client.close(); }
