const knownSites = new Set(['https://meet.google.com', 'https://web.whatsapp.com', 'https://teams.microsoft.com', 'https://teams.live.com', 'https://teams.cloud.microsoft']);
const browser = (navigator.userAgentData?.brands || []).some(item => item.brand === 'Microsoft Edge') ? 'edge'
  : (navigator.userAgentData?.brands || []).some(item => item.brand === 'Google Chrome') ? 'chrome' : 'chromium';
async function request(connection, route, body, paired = true) {
  const response = await fetch(`http://127.0.0.1:${connection.port}/v1/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(paired ? { Authorization: `Bearer ${connection.token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(4000), credentials: 'omit', redirect: 'error',
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'LocalFlow could not be reached.');
  return value;
}
async function handle(message, sender) {
  if (message.type === 'rtc-state') {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return;
    let site, conferenceId;
    try {
      const url = new URL(sender.url); site = url.origin;
      if (!knownSites.has(site) && !(url.protocol === 'https:' && /(^|\.)zoom\.us$/.test(url.hostname))) return;
      if (site === 'https://meet.google.com') conferenceId = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/.exec(url.pathname)?.[1];
    } catch { return; }
    const { connection } = await chrome.storage.local.get('connection');
    if (!connection) return;
    try {
      await request(connection, 'events', { state: message.state, callId: message.callId, pageId: message.pageId,
        sequence: message.sequence, observedAt: message.observedAt, inboundPackets: message.inboundPackets,
        outboundPackets: message.outboundPackets, browser, site, conferenceId });
      await chrome.storage.local.set({ lastError: null, lastSeenAt: Date.now() });
    } catch (error) { await chrome.storage.local.set({ lastError: error.message }); }
    return { ok: true };
  }
  // Pairing credentials can only be changed by the extension popup, never by a web page.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) throw new Error('Open the LocalFlow extension popup.');
  if (message.type === 'status') {
    const { connection, lastError, lastSeenAt } = await chrome.storage.local.get(['connection', 'lastError', 'lastSeenAt']);
    return { paired: Boolean(connection), lastError, lastSeenAt };
  }
  if (message.type === 'disconnect') { await chrome.storage.local.remove(['connection', 'lastError', 'lastSeenAt']); return { paired: false }; }
  if (message.type === 'pair') {
    if (typeof message.code !== 'string' || message.code.length > 1024 || !message.code.startsWith('localflow:')) throw new Error('Paste a connection code from LocalFlow.');
    let code;
    try { code = JSON.parse(atob(message.code.slice(10).replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw new Error('The connection code is invalid.'); }
    if (code.version !== 1 || !Number.isInteger(code.port) || code.port < 1024 || code.port > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(code.secret)) throw new Error('The connection code is invalid.');
    const value = await request(code, 'pair', { secret: code.secret }, false);
    await chrome.storage.local.set({ connection: { port: code.port, token: value.token }, lastError: null });
    return { paired: true };
  }
  throw new Error('Unknown extension operation.');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  Promise.resolve().then(() => handle(message || {}, sender)).then(value => reply({ value }), error => reply({ error: error.message }));
  return true;
});
