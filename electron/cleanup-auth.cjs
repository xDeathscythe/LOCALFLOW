const fs = require('node:fs');
const path = require('node:path');
const { CodexClient } = require('./codex-client.cjs');
const EMPTY_STATUS = { connected: false, mode: null, busy: false, stage: 'idle', message: 'Connect with Codex to use Niwa and text cleanup.', deviceCode: null, deviceUrl: null };

// Codex owns OAuth, token storage and refresh. No credentials from another app.
function createCleanupAuthManager({ codexBin, userDataPath, notify = () => {}, openBrowser = () => {}, closeBrowser = () => {}, Client = CodexClient }) {
  const home = path.join(userDataPath, 'niwa', 'codex');
  let client, connecting, loginId, status = { ...EMPTY_STATUS };
  const publish = patch => { status = { ...status, ...patch }; notify({ ...status }); return { ...status }; };
  const accountStatus = account => publish({ connected: Boolean(account), mode: account ? (account.type === 'apiKey' ? 'api-key' : 'codex') : null, busy: false, stage: account ? 'connected' : 'idle', message: account ? 'Codex is connected to LocalFlow.' : EMPTY_STATUS.message, deviceCode: null, deviceUrl: null });
  async function connection() {
    if (client && !client.closed) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      fs.mkdirSync(home, { recursive: true });
      const next = new Client(codexBin(), { cwd: userDataPath, env: { ...process.env, CODEX_HOME: home } });
      next.on('request', packet => next.reject(packet.id, 'Unsupported authentication request'));
      next.on('notification', ({ method, params }) => {
        if (method !== 'account/login/completed') return;
        loginId = null;
        if (!params.success) publish({ busy: false, stage: 'error', message: params.error || 'Sign-in did not complete.' });
        else void inspect().catch(error => publish({ busy: false, stage: 'error', message: error.message }));
      });
      next.on('closed', () => { if (client === next) { client = null; loginId = null; if (status.busy) publish({ busy: false, stage: 'error', message: 'Codex connection closed. Please reconnect.' }); } });
      try { await next.initialize(); client = next; return next; }
      catch (error) { next.close(); throw error; }
    })();
    try { return await connecting; } finally { connecting = null; }
  }
  async function inspect() {
    if (loginId) return { ...status };
    const result = await (await connection()).request('account/read', { refreshToken: false });
    return accountStatus(result.account);
  }
  async function start(params) {
    if (status.busy) throw new Error('A Codex sign-in is already in progress.');
    publish({ busy: true, stage: params.type === 'chatgpt' ? 'device-code' : 'api-key', message: 'Complete sign-in in your browser.' });
    try {
      const result = await (await connection()).request('account/login/start', params);
      loginId = result.loginId;
      if (result.authUrl) {
        const url = new URL(result.authUrl);
        if (url.protocol !== 'https:' || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].includes(url.hostname)) throw new Error('Codex returned an unexpected sign-in URL.');
        publish({ deviceUrl: result.authUrl });
        await openBrowser(result.authUrl);
        return { ...status };
      }
      return inspect();
    } catch (error) { publish({ busy: false, stage: 'error', message: error.message }); throw error; }
  }
  return {
    inspect,
    models: async () => (await (await connection()).request('model/list', {})).data,
    connectCodex: () => start({ type: 'chatgpt' }),
    connectApiKey: key => {
      if (typeof key !== 'string' || !key.startsWith('sk-') || key.trim().length < 20 || /\s/.test(key)) throw new Error('Enter a valid OpenAI API key.');
      return start({ type: 'apiKey', apiKey: key });
    },
    openCurrentBrowser: async () => { if (status.deviceUrl) await openBrowser(status.deviceUrl); return { ...status }; },
    cancel: async () => { if (loginId && client && !client.closed) await client.request('account/login/cancel', { loginId }); loginId = null; closeBrowser(); return inspect(); },
    disconnect: async () => { await (await connection()).request('account/logout', {}); loginId = null; return accountStatus(null); },
    close: () => client?.close(),
  };
}
module.exports = { createCleanupAuthManager };
