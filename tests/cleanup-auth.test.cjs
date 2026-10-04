const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createCleanupAuthManager } = require('../host/cleanup-auth.cjs');
const directory = fs.mkdtempSync(path.resolve('runtime/oauth-test-'));
let client, opened;
class FakeClient extends EventEmitter {
  constructor(_binary, options) { super(); client = this; this.options = options; this.calls = []; this.account = null; }
  async initialize() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: this.account };
    if (method === 'account/login/start') return { loginId: 'test', authUrl: 'https://auth.openai.com/authorize?state=test' };
    if (method === 'account/logout') this.account = null;
    return {};
  }
  close() { this.closed = true; }
}
(async () => {
  const manager = createCleanupAuthManager({ codexBin: () => 'bundled-codex', userDataPath: directory, Client: FakeClient, openBrowser: url => { opened = url; } });
  assert.equal((await manager.inspect()).connected, false);
  assert.equal(client.options.env.CODEX_HOME, path.join(directory, 'niwa', 'codex'));
  assert.throws(() => manager.connectApiKey('bad'), /valid/);
  const starting = await manager.connectCodex();
  assert(starting.busy);
  assert.equal(opened, 'https://auth.openai.com/authorize?state=test');
  assert.deepEqual(client.calls.find(c => c.method === 'account/login/start').params, { type: 'chatgpt' });
  await assert.rejects(manager.connectCodex(), /already/);
  await manager.cancel();
  assert(client.calls.some(c => c.method === 'account/login/cancel' && c.params.loginId === 'test'));
  await manager.connectCodex();
  client.account = { type: 'chatgpt' };
  client.emit('notification', { method: 'account/login/completed', params: { success: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await manager.inspect()).connected, true);
  assert.equal((await manager.disconnect()).connected, false);
  assert(!client.calls.some(c => c.params?.type === 'chatgptAuthTokens'));
  manager.close();
  console.log('LOCALFLOW_MANAGED_OAUTH_ISOLATION_CANCEL_LOGOUT_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
