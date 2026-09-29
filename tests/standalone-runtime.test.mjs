import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import auth from '../electron/cleanup-auth.cjs';
import codex from '../electron/codex-client.cjs';

const directory = mkdtempSync(resolve('runtime/standalone-check-'));
const binary = resolve(process.argv[2] || 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const home = join(directory, 'niwa', 'codex');
mkdirSync(home, { recursive: true });
let opened = false;
const manager = auth.createCleanupAuthManager({ codexBin: () => binary, userDataPath: directory, openBrowser: url => { assert.equal(new URL(url).protocol, 'https:'); opened = true; } });
try {
  assert.equal((await manager.inspect()).connected, false);
  assert.equal((await manager.connectCodex()).busy, true);
  assert(opened, 'managed OAuth returns an authorization URL without desktop Codex');
  assert.equal((await manager.cancel()).connected, false);
  console.log('BUNDLED_CODEX_MANAGED_OAUTH_START_CANCEL_OK');
} finally { manager.close(); }
const client = new codex.CodexClient(binary, { cwd: directory, env: { ...process.env, CODEX_HOME: home } });
try {
  await client.initialize();
  assert.equal((await client.request('account/read', { refreshToken: false })).account, null);
  console.log('BUNDLED_CODEX_STANDALONE_NO_EXTERNAL_ACCOUNT_OK');
} finally { client.close(); }
