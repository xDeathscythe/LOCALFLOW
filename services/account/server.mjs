import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { calculateJwkThumbprint, exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import { readBody, sendJson, serviceUrl } from '../../host/account/http.mjs';
import { createTunnelProvisioner } from './cloudflare.mjs';
import { loginPage } from './login-page.mjs';
import { publicEncryptionKey } from '../../host/account/protocol.mjs';

const digest = value => createHash('sha256').update(value).digest('base64url');
const secret = () => randomBytes(32).toString('base64url');
const fail = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };
const id = value => typeof value === 'string' && /^[\w-]{8,100}$/.test(value);
const text = (value, maximum = 150) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

export async function createAccountBroker({ directory, origin, provider, publishableKey, provisionTunnel = null, allowLoopback = false }) {
  origin = serviceUrl(origin, allowLoopback);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyFile = join(directory, 'ticket-key.pem');
  if (!existsSync(keyFile)) { const { privateKey } = generateKeyPairSync('ed25519'); writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' }); }
  const pem = readFileSync(keyFile, 'utf8'), privateKey = await importPKCS8(pem, 'EdDSA');
  const { createPublicKey } = await import('node:crypto');
  const publicKey = await importSPKI(createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString(), 'EdDSA');
  const jwk = { ...await exportJWK(publicKey), kid: digest(createPublicKey(pem).export({ type: 'spki', format: 'der' })), alg: 'EdDSA', use: 'sig' };
  const db = new DatabaseSync(join(directory, 'accounts.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,profile TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hosts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,device_id TEXT NOT NULL,name TEXT NOT NULL,endpoint TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 0,last_seen INTEGER NOT NULL DEFAULT 0,tunnel_id TEXT);
    CREATE TABLE IF NOT EXISTS logins(id TEXT PRIMARY KEY,challenge TEXT NOT NULL,callback TEXT NOT NULL,state TEXT NOT NULL,name TEXT NOT NULL,expires INTEGER NOT NULL,profile TEXT,code_hash TEXT,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tickets_used(id TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(hosts)').all().some(column => column.name === 'encryption_jwk')) db.exec("ALTER TABLE hosts ADD COLUMN encryption_jwk TEXT NOT NULL DEFAULT '{}'");
  const auth = request => {
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
    const device = token && db.prepare('SELECT * FROM devices WHERE token_hash=? AND revoked=0 AND expires>?').get(digest(token), Date.now());
    if (!device) fail('Device sign-in has expired or was revoked.', 401);
    return device;
  };
  const hostFor = (device, hostId, workspaceId, enabled = false) => {
    const host = db.prepare('SELECT * FROM hosts WHERE id=? AND user_id=? AND workspace_id=?').get(hostId || '', device.user_id, workspaceId || '');
    if (!host || (enabled && !host.enabled)) fail('This computer is unavailable to this account.');
    return host;
  };
  const asHost = (device, hostId, workspaceId, enabled = false) => { const host = hostFor(device, hostId, workspaceId, enabled); if (host.device_id !== device.id) fail('Only the linked computer can perform this operation.'); return host; };
  const permitted = (device, value) => {
    const host = asHost(device, value.hostId, value.workspaceId, true);
    const client = db.prepare('SELECT id FROM devices WHERE id=? AND user_id=? AND revoked=0 AND expires>?').get(value.deviceId, host.user_id, Date.now());
    if (!client) fail('The requesting device was revoked.');
    return host;
  };
  const publicDevice = row => ({ id: row.id, name: row.name, revoked: Boolean(row.revoked), current: false });
  const limits = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin), path = url.pathname, method = request.method;
      if (request.headers.origin && request.headers.origin !== origin) fail('Origin is not allowed.');
      if (method === 'OPTIONS') { sendJson(response, 405, { error: 'Cross-origin requests are not enabled.' }); return; }
      if (path === '/v1/config' && method === 'GET') { sendJson(response, 200, { name: 'LocalFlow', protocol: 1, issuer: origin, jwks: { keys: [jwk] }, managedTunnels: Boolean(provisionTunnel) }); return; }
      if (path === '/connect' && method === 'GET') {
        const login = db.prepare('SELECT id FROM logins WHERE id=? AND expires>? AND used=0').get(url.searchParams.get('request'), Date.now());
        if (!login) fail('This sign-in request expired. Start again in LocalFlow.', 400);
        const nonce = secret();
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic' https:; style-src 'unsafe-inline' https:; connect-src 'self' https:; img-src https: data:; frame-src https:; font-src https:; base-uri 'none'; frame-ancestors 'none'` });
        response.end(loginPage({ publishableKey, requestId: login.id, origin, nonce })); return;
      }
      if (!['GET', 'POST'].includes(method)) fail('Method is not allowed.', 405);
      const value = method === 'POST' ? await readBody(request, 32_000) : {};
      if (path === '/v1/login/start' && method === 'POST') {
        const address = request.socket.remoteAddress, previous = limits.get(address), now = Date.now();
        const limit = previous?.until > now ? previous : { count: 0, until: now + 3_600_000 };
        if (++limit.count > 40) fail('Too many sign-in requests. Try again later.', 429); limits.set(address, limit);
        for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
        if (!/^[A-Za-z0-9_-]{43}$/.test(value.challenge || '') || !/^[A-Za-z0-9_-]{43}$/.test(value.state || '') || !text(value.name)) fail('Invalid sign-in request.', 400);
        const callback = new URL(value.redirectUri);
        if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || !callback.port || callback.pathname !== '/callback' || callback.search || callback.hash || callback.username || callback.password) fail('Only a loopback desktop callback is allowed.', 400);
        db.prepare('DELETE FROM logins WHERE expires<?').run(now);
        if (db.prepare('SELECT count(*) AS count FROM logins').get().count > 10_000) fail('Sign-in is busy. Try again later.', 503);
        const requestId = randomUUID();
        db.prepare('INSERT INTO logins(id,challenge,callback,state,name,expires) VALUES(?,?,?,?,?,?)').run(requestId, value.challenge, callback.href, value.state, value.name.trim(), now + 10 * 60_000);
        sendJson(response, 200, { requestId, authorizationUrl: `${origin}/connect?request=${requestId}` }); return;
      }
      if (path === '/v1/login/complete' && method === 'POST') {
        const login = db.prepare('SELECT * FROM logins WHERE id=? AND expires>? AND used=0 AND code_hash IS NULL').get(value.requestId || '', Date.now());
        if (!login) fail('Sign-in request expired or was already completed.', 400);
        const user = await provider.authenticate(new Request(origin + path, { headers: { authorization: request.headers.authorization || '' } }));
        if (!user?.id) fail('Invalid account identity.', 401);
        const code = secret();
        const updated = db.prepare('UPDATE logins SET profile=?,code_hash=? WHERE id=? AND code_hash IS NULL').run(JSON.stringify(user), digest(code), login.id);
        if (!updated.changes) fail('Sign-in request already completed.', 409);
        const callback = new URL(login.callback); callback.searchParams.set('code', code); callback.searchParams.set('state', login.state);
        sendJson(response, 200, { redirectUri: callback.href }); return;
      }
      if (path === '/v1/login/exchange' && method === 'POST') {
        if (!/^[A-Za-z0-9_-]{43,128}$/.test(value.verifier || '') || !/^[A-Za-z0-9_-]{43}$/.test(value.code || '')) fail('Invalid sign-in exchange.', 400);
        const login = db.prepare('SELECT * FROM logins WHERE id=? AND code_hash=? AND challenge=? AND used=0 AND expires>?').get(value.requestId || '', digest(value.code), digest(value.verifier), Date.now());
        if (!login?.profile) fail('Invalid or expired sign-in exchange.', 401);
        const user = JSON.parse(login.profile), token = secret(), deviceId = randomUUID(), expiresAt = Date.now() + 30 * 86_400_000;
        db.exec('BEGIN IMMEDIATE');
        try { const result = db.prepare('UPDATE logins SET used=1 WHERE id=? AND used=0').run(login.id); if (!result.changes) fail('Sign-in exchange was already used.', 401); db.prepare('INSERT INTO devices(id,user_id,name,token_hash,expires,profile) VALUES(?,?,?,?,?,?)').run(deviceId, user.id, login.name, digest(token), expiresAt, JSON.stringify(user)); db.exec('COMMIT'); }
        catch (error) { db.exec('ROLLBACK'); throw error; }
        sendJson(response, 200, { deviceId, token, expiresAt, user }); return;
      }
      const device = auth(request);
      if (path === '/v1/device/renew' && method === 'POST') {
        const expiresAt = Date.now() + 30 * 86_400_000; db.prepare('UPDATE devices SET expires=? WHERE id=?').run(expiresAt, device.id); sendJson(response, 200, { expiresAt }); return;
      }
      if (path === '/v1/devices' && method === 'GET') { sendJson(response, 200, { devices: db.prepare('SELECT id,name,revoked FROM devices WHERE user_id=?').all(device.user_id).map(row => ({ ...publicDevice(row), current: row.id === device.id })) }); return; }
      if (path === '/v1/devices/revoke' && method === 'POST') {
        const result = db.prepare('UPDATE devices SET revoked=1 WHERE id=? AND user_id=?').run(value.deviceId || '', device.user_id);
        if (!result.changes) fail('Device not found.', 404);
        db.prepare('UPDATE hosts SET enabled=0,last_seen=0 WHERE device_id=? AND user_id=?').run(value.deviceId, device.user_id);
        sendJson(response, 200, { revoked: true }); return;
      }
      if (path === '/v1/hosts' && method === 'GET') {
        const hosts = db.prepare('SELECT id,workspace_id AS workspaceId,name,endpoint,enabled,last_seen AS lastSeen,encryption_jwk FROM hosts WHERE user_id=?').all(device.user_id).map(({ encryption_jwk, ...host }) => ({ ...host, encryptionKey: JSON.parse(encryption_jwk), enabled: Boolean(host.enabled), online: Boolean(host.enabled && host.lastSeen > Date.now() - 90_000) }));
        sendJson(response, 200, { hosts }); return;
      }
      if (path === '/v1/hosts/register' && method === 'POST') {
        if (!id(value.hostId) || !id(value.workspaceId) || !text(value.name)) fail('Invalid computer registration.', 400);
        const existing = db.prepare('SELECT * FROM hosts WHERE id=?').get(value.hostId);
        if (existing && (existing.user_id !== device.user_id || existing.workspace_id !== value.workspaceId)) fail('This workspace belongs to a different account.');
        let encryptionKey; try { encryptionKey = publicEncryptionKey(value.encryptionKey); } catch { fail('Invalid computer encryption key.', 400); }
        db.prepare('INSERT INTO hosts(id,user_id,workspace_id,device_id,name,encryption_jwk) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET device_id=excluded.device_id,name=excluded.name,encryption_jwk=excluded.encryption_jwk,enabled=0,last_seen=0').run(value.hostId, device.user_id, value.workspaceId, device.id, value.name, JSON.stringify(encryptionKey));
        sendJson(response, 200, { registered: true }); return;
      }
      if (path === '/v1/hosts/tunnel' && method === 'POST') {
        const host = asHost(device, value.hostId, value.workspaceId);
        if (!provisionTunnel) fail('Managed remote access has not been configured by the service operator.', 503);
        if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) fail('Invalid local Notes port.', 400);
        const tunnel = await provisionTunnel({ hostId: host.id, port: value.port, existingTunnelId: host.tunnel_id });
        const endpoint = serviceUrl(tunnel.endpoint);
        db.prepare('UPDATE hosts SET endpoint=?,tunnel_id=?,enabled=1 WHERE id=?').run(endpoint, tunnel.tunnelId, host.id);
        sendJson(response, 200, { endpoint, token: tunnel.token }); return;
      }
      if (path === '/v1/hosts/heartbeat' && method === 'POST') {
        const host = asHost(device, value.hostId, value.workspaceId);
        db.prepare('UPDATE hosts SET last_seen=? WHERE id=?').run(value.online === true && host.enabled ? Date.now() : 0, host.id);
        sendJson(response, 200, { acknowledged: true }); return;
      }
      if (path === '/v1/hosts/disable' && method === 'POST') { const host = asHost(device, value.hostId, value.workspaceId); db.prepare('UPDATE hosts SET enabled=0,last_seen=0 WHERE id=?').run(host.id); sendJson(response, 200, { enabled: false }); return; }
      if (path === '/v1/tickets' && method === 'POST') {
        const host = hostFor(device, value.hostId, value.workspaceId, true);
        if (!['read', 'write'].includes(value.permission)) fail('Invalid Notes permission.', 400);
        let clientKey; try { clientKey = publicEncryptionKey(value.clientKey); } catch { fail('Invalid client encryption key.', 400); }
        const hostKey = await calculateJwkThumbprint(JSON.parse(host.encryption_jwk));
        const ticket = await new SignJWT({ deviceId: device.id, hostId: host.id, workspaceId: host.workspace_id, clientKey, hostKey, scope: value.permission === 'write' ? ['notes:read', 'notes:write'] : ['notes:read'] }).setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid, typ: 'JWT' }).setIssuer(origin).setSubject(device.user_id).setAudience(host.id).setJti(randomUUID()).setIssuedAt().setExpirationTime('60s').sign(privateKey);
        sendJson(response, 200, { ticket, endpoint: host.endpoint, expiresIn: 60 }); return;
      }
      if (path === '/v1/tickets/consume' && method === 'POST') {
        const host = asHost(device, value.hostId, value.workspaceId, true);
        let claims;
        try { ({ payload: claims } = await jwtVerify(value.ticket, publicKey, { algorithms: ['EdDSA'], issuer: origin, audience: host.id, maxTokenAge: '60s', requiredClaims: ['jti', 'sub', 'exp', 'iat'] })); } catch { fail('Invalid or expired access ticket.', 401); }
        if (claims.sub !== device.user_id || claims.hostId !== host.id || claims.workspaceId !== host.workspace_id) fail('Access ticket does not match this workspace.');
        permitted(device, { hostId: host.id, workspaceId: host.workspace_id, deviceId: claims.deviceId });
        db.prepare('DELETE FROM tickets_used WHERE expires<?').run(Date.now());
        try { db.prepare('INSERT INTO tickets_used VALUES(?,?)').run(claims.jti, claims.exp * 1000); } catch { fail('Access ticket was already used.', 401); }
        sendJson(response, 200, { claims }); return;
      }
      if (path === '/v1/devices/authorize' && method === 'POST') { permitted(device, value); sendJson(response, 200, { authorized: true }); return; }
      if (path === '/v1/calendar/list' && method === 'POST') { sendJson(response, 200, await provider.calendar(device.user_id, 'list', { pageToken: value.pageToken })); return; }
      if (path === '/v1/calendar/events' && method === 'POST') {
        if (!text(value.calendarId, 1024) || [value.syncToken, value.pageToken].some(item => item !== undefined && (typeof item !== 'string' || item.length > 4096))) fail('Invalid calendar request.', 400);
        if (!value.syncToken && (![value.timeMin, value.timeMax].every(item => typeof item === 'string' && item.length < 40 && Number.isFinite(Date.parse(item))) || Date.parse(value.timeMax) <= Date.parse(value.timeMin) || Date.parse(value.timeMax) - Date.parse(value.timeMin) > 220 * 86_400_000)) fail('Invalid calendar time window.', 400);
        sendJson(response, 200, await provider.calendar(device.user_id, 'events', value)); return;
      }
      fail('Account operation not found.', 404);
    } catch (error) { if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : 'The account service could not complete this request.' }); else response.end(); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  return { server, close: () => new Promise(resolve => { server.close(() => { db.close(); resolve(); }); server.closeIdleConnections(); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { createClerkProvider } = await import('./clerk.mjs');
  const origin = serviceUrl(process.env.LOCALFLOW_ACCOUNT_ORIGIN || ''), publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  const provider = createClerkProvider({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey, origin });
  const provisionTunnel = createTunnelProvisioner({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, zoneId: process.env.CLOUDFLARE_ZONE_ID, apiToken: process.env.CLOUDFLARE_API_TOKEN, domain: process.env.LOCALFLOW_REMOTE_DOMAIN });
  const broker = await createAccountBroker({ directory: process.env.LOCALFLOW_ACCOUNT_DATA || './data', origin, provider, publishableKey, provisionTunnel });
  broker.server.listen(Number(process.env.PORT || 8788), '127.0.0.1', () => process.stdout.write('LocalFlow account service is listening on loopback.\n'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void broker.close().then(() => process.exit(0)));
}
