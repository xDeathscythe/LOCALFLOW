import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;
const browsers = { chrome: ['chrome.exe'], edge: ['msedge.exe'], chromium: ['chrome.exe', 'msedge.exe'] };
const sites = new Map([
  ['https://meet.google.com', 'Google Meet'], ['https://web.whatsapp.com', 'WhatsApp'],
  ['https://teams.microsoft.com', 'Microsoft Teams'], ['https://teams.live.com', 'Microsoft Teams'],
  ['https://teams.cloud.microsoft', 'Microsoft Teams'],
]);
function siteLabel(origin) {
  if (sites.has(origin)) return sites.get(origin);
  try { const url = new URL(origin); if (url.protocol === 'https:' && url.origin === origin && /(^|\.)zoom\.us$/.test(url.hostname)) return 'Zoom'; } catch {}
  return null;
}
const secret = () => randomBytes(32).toString('base64url');
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 8192) { reject(Object.assign(new Error('Request is too large.'), { status: 413 })); request.pause(); }
      else chunks.push(chunk);
    });
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); } });
    request.on('error', reject);
  });
}

/** Private, local metadata only. A browser signal offers transcription; it never starts it. */
export async function createBrowserBridge({ directory, onEvent, getSources = async () => ({}), port, now = Date.now }) {
  const file = path.join(directory, 'meetings', 'browser-bridge.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') saved = {}; }
  if (!extensionOrigin.test(saved.origin) || typeof saved.token !== 'string' || saved.token.length !== 43) { delete saved.origin; delete saved.token; }
  let pairing = null, listening = false, error = null, lastSeenAt = null, rateWindow = now(), requests = 0;
  const calls = new Map();
  const persist = () => {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomBytes(5).toString('hex')}.tmp`;
    writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  };
  const ended = (id, reason) => {
    const call = calls.get(id);
    if (!call || call.ended) return;
    call.ended = true; call.reason = reason; call.expiresAt = now() + 60_000;
    Promise.resolve(onEvent({ type: 'call-ended', callId: id, reason })).catch(() => {});
  };
  async function candidate(body, origin) {
    const label = siteLabel(body.site);
    if (!label || typeof body.pageId !== 'string' || !identifier.test(body.pageId) || typeof body.callId !== 'string' || !identifier.test(body.callId) || !Object.hasOwn(browsers, body.browser)
      || !['connected', 'ended'].includes(body.state) || !Number.isSafeInteger(body.sequence) || body.sequence < 0
      || !Number.isFinite(body.observedAt) || Math.abs(now() - body.observedAt) > 30_000) throw Object.assign(new Error('Invalid or stale call signal.'), { status: 400 });
    const id = `browser:${origin.slice('chrome-extension://'.length)}:${body.pageId}:${body.callId}`;
    const previous = calls.get(id);
    if (previous && (body.sequence <= previous.sequence || (previous.ended && previous.reason !== 'signal-expired'))) return;
    if (body.state === 'ended') { ended(id, 'connection-ended'); return; }
    if (!Number.isSafeInteger(body.inboundPackets) || body.inboundPackets < 1 || !Number.isSafeInteger(body.outboundPackets) || body.outboundPackets < 1)
      throw Object.assign(new Error('A call requires incoming and outgoing audio transport.'), { status: 400 });
    if (calls.size >= 256 && !previous) throw Object.assign(new Error('Too many active call signals.'), { status: 429 });
    calls.set(id, { sequence: body.sequence, expiresAt: now() + 20_000, ended: false });
    if (previous && !previous.ended) return;
    let processId, microphoneDeviceId;
    try {
      const sources = await getSources();
      const matches = (sources.sessions || []).filter(session => session.active === true
        && browsers[body.browser].includes(String(session.application || '').toLowerCase()));
      const processIds = [...new Set(matches.map(session => session.processId).filter(id => Number.isSafeInteger(id) && id > 0))];
      if (processIds.length === 1) {
        processId = processIds[0];
        microphoneDeviceId = matches.find(session => session.processId === processId && session.source === 'microphone')?.deviceId;
      }
    } catch { /* A verified browser call may still need the user's audio source selection. */ }
    const conferenceId = body.site === 'https://meet.google.com' && typeof body.conferenceId === 'string' && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(body.conferenceId) ? body.conferenceId : undefined;
    await onEvent({ type: 'candidate', callId: id, confirmedCall: true, capture: true, render: true, conferenceId,
      application: label, processId, microphoneDeviceId, site: body.site, captureScope: 'application', evidence: 'browser-rtc-audio' });
  }

  const server = http.createServer(async (request, response) => {
    const reply = (status, value) => {
      if (response.writableEnded) return;
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      const origin = request.headers.origin;
      const actualPort = server.address()?.port;
      if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.host !== `127.0.0.1:${actualPort}`
        || typeof origin !== 'string' || !extensionOrigin.test(origin)) return reply(403, { error: 'Untrusted local origin.' });
      const isPair = request.url === '/v1/pair';
      if ((!isPair && request.url !== '/v1/events') || (!isPair && origin !== saved.origin)) return reply(403, { error: 'Extension is not paired.' });
      if (isPair && (!pairing || pairing.expiresAt <= now())) return reply(403, { error: 'Create a new connection code in LocalFlow.' });
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'POST');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        response.setHeader('Access-Control-Allow-Private-Network', 'true');
        return reply(204, null);
      }
      if (request.method !== 'POST') return reply(405, { error: 'POST required.' });
      if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reply(415, { error: 'JSON required.' });
      if (now() - rateWindow >= 60_000) { rateWindow = now(); requests = 0; }
      if (++requests > 180) return reply(429, { error: 'Too many local requests.' });
      if (!isPair && !equal(request.headers.authorization, `Bearer ${saved.token || ''}`)) return reply(401, { error: 'Invalid extension credential.' });
      const body = await readBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid event object.' });
      if (isPair) {
        if (!equal(body.secret, pairing.secret)) return reply(403, { error: 'Invalid connection code.' });
        for (const id of calls.keys()) ended(id, 'extension-repaired');
        const token = secret();
        saved = { port: actualPort, origin, token }; persist(); pairing = null;
        return reply(200, { token, port: actualPort });
      }
      await candidate(body, origin); lastSeenAt = now();
      reply(200, { ok: true });
    } catch (failure) { reply(failure.status || 500, { error: failure.status ? failure.message : 'Local call detection is unavailable.' }); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000;
  const requestedPort = port ?? (Number.isInteger(saved.port) && saved.port > 1024 && saved.port < 65536 ? saved.port : 0);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(requestedPort, '127.0.0.1', resolve); });
    listening = true; saved.port = server.address().port; persist();
  } catch (failure) { error = `Browser detection could not listen locally: ${failure.message}`; }
  server.on('error', failure => { error = failure.message; });
  const expiry = setInterval(() => {
    for (const [id, call] of calls) {
      if (call.expiresAt > now()) continue;
      if (call.ended) calls.delete(id); else ended(id, 'signal-expired');
    }
  }, 5000);
  expiry.unref(); server.unref();
  return {
    status: () => ({ listening, port: saved.port || null, paired: Boolean(saved.origin && saved.token), extensionOrigin: saved.origin || null, lastSeenAt, error }),
    pair() {
      if (!listening) throw new Error(error || 'Browser detection is unavailable.');
      pairing = { secret: secret(), expiresAt: now() + 5 * 60_000 };
      return { code: `localflow:${Buffer.from(JSON.stringify({ version: 1, port: saved.port, secret: pairing.secret })).toString('base64url')}`, expiresAt: pairing.expiresAt, port: saved.port };
    },
    disconnect() {
      for (const id of calls.keys()) ended(id, 'extension-disconnected');
      pairing = null; delete saved.origin; delete saved.token; persist();
      return this.status();
    },
    async close() {
      clearInterval(expiry);
      for (const id of calls.keys()) ended(id, 'desktop-closed');
      listening = false;
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}
