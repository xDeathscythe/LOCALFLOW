// Explicit opt-in: uses an existing LocalFlow login, sends one harmless cloud turn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CodexClient } = require('../host/codex-client.cjs');
const [binary, home] = process.argv.slice(2);
assert(binary && home, 'Pass the packaged codex.exe and an authorized Codex home');
const cwd = fs.mkdtempSync(path.resolve('runtime/packaged-agent-'));
const client = new CodexClient(path.resolve(binary), { cwd, env: { ...process.env, CODEX_HOME: path.resolve(home) } });
(async () => {
  let timer;
  try {
    await client.initialize();
    assert((await client.request('account/read', { refreshToken: false })).account, 'LocalFlow is not signed in');
    const models = (await client.request('model/list', {})).data;
    const model = models.find(item => item.isDefault) || models[0];
    const { thread } = await client.request('thread/start', { cwd, model: model.model, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never' });
    let answer = '';
    const completed = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Agent turn timed out')), 90000);
      client.on('notification', ({ method, params }) => {
        if (params.threadId !== thread.id) return;
        if (method === 'item/completed' && params.item.type === 'agentMessage') answer += params.item.text;
        if (method === 'turn/completed') params.turn.status === 'completed' ? resolve() : reject(new Error('Agent turn failed'));
      });
    });
    client.on('request', packet => client.reject(packet.id, 'No tool actions permitted in installation smoke test'));
    await client.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Reply exactly LOCALFLOW_INSTALLED_AGENT_OK. Do not use tools or modify any files.', text_elements: [] }] });
    await completed;
    assert.match(answer, /LOCALFLOW_INSTALLED_AGENT_OK/);
    console.log('PACKAGED_AUTHENTICATED_AGENT_RESPONSE_OK', model.model);
  } finally { clearTimeout(timer); client.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
