import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, createLocalJWKSet, jwtVerify } from 'jose';
import { readBody, sendJson } from '../account/http.mjs';
import { readNoteAsset } from './assets.mjs';
import { openRemote, publicEncryptionKey, sealRemote } from './envelope.mjs';

export async function createRemoteNotesServer({ directory, notes, hostId, workspaceId, ownerId, broker, configuration, encryptionKey, port = 0 }) {
  const sessions = new Map(), key = createLocalJWKSet(configuration.jwks), hostKey = await calculateJwkThumbprint(publicEncryptionKey(encryptionKey));
  let active = 0, windowStart = performance.now(), requests = 0;
  const handle = async (request, response) => {
    if (performance.now() - windowStart >= 10_000) { windowStart = performance.now(); requests = 0; }
    // Bound desktop memory and crypto work before reading untrusted encrypted bodies.
    const overloaded = active >= 2 || ++requests > 60, oversized = Number(request.headers['content-length']) > 16_000_000;
    if (overloaded || oversized) {
      response.setHeader('connection', 'close');
      if (overloaded) response.setHeader('retry-after', '10');
      response.once('finish', () => request.destroy());
      sendJson(response, overloaded ? 429 : 413, { error: overloaded ? 'Remote Notes is busy. Retry shortly.' : 'Request is too large.' }); return;
    }
    active++;
    let handled = false, finished = false, counted = true;
    const release = () => { if (handled && finished && counted) { counted = false; active--; } };
    for (const event of ['finish', 'close']) response.once(event, () => { finished = true; release(); });
    let clientKey, requestId;
    const reply = async (status, value) => sendJson(response, status, clientKey ? { envelope: await sealRemote({ requestId, status, value }, clientKey) } : value);
    try {
      if (request.headers.origin) throw Object.assign(new Error('Browser origin is not allowed.'), { status: 403 });
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/health' && request.method === 'GET') { sendJson(response, 200, { name: 'LocalFlow Notes', protocol: 1, encryption: 'JWE' }); return; }
      if (url.pathname === '/v1/session' && request.method === 'POST') {
        const { ticket, envelope } = await readBody(request, 32_000);
        let claims;
        try { ({ payload: claims } = await jwtVerify(ticket, key, { issuer: configuration.issuer, audience: hostId, algorithms: ['EdDSA'], maxTokenAge: '60s', requiredClaims: ['sub', 'jti', 'iat', 'exp'] })); }
        catch { throw Object.assign(new Error('Invalid or expired access ticket.'), { status: 401 }); }
        if (claims.sub !== ownerId || claims.hostId !== hostId || claims.workspaceId !== workspaceId || claims.hostKey !== hostKey || !Array.isArray(claims.scope) || !claims.scope.includes('notes:read')) throw Object.assign(new Error('Access ticket belongs to a different workspace or encryption key.'), { status: 403 });
        clientKey = publicEncryptionKey(claims.clientKey);
        const handshake = await openRemote(envelope, encryptionKey);
        if (handshake?.ticketId !== claims.jti || typeof handshake.nonce !== 'string' || !/^[\w-]{30,100}$/.test(handshake.nonce)) throw Object.assign(new Error('Invalid encrypted session handshake.'), { status: 401 });
        requestId = handshake.nonce;
        await broker('/v1/tickets/consume', { ticket, hostId, workspaceId });
        const token = randomBytes(32).toString('base64url'), expiresAt = Date.now() + 300_000;
        for (const [id, session] of sessions) if (session.expiresAt < Date.now()) sessions.delete(id);
        if (sessions.size >= 100) throw Object.assign(new Error('Too many active remote sessions.'), { status: 429 });
        sessions.set(token, { claims, expiresAt, used: new Map() }); await reply(200, { token, expiresAt, hostId, workspaceId, protocol: 1 }); return;
      }
      if (url.pathname !== '/v1/notes/request' || request.method !== 'POST') throw Object.assign(new Error('Use the encrypted Notes protocol.'), { status: 401 });
      const body = await readBody(request, 16_000_000);
      let message;
      try { message = await openRemote(body.envelope, encryptionKey); } catch { throw Object.assign(new Error('Invalid encrypted request.'), { status: 400 }); }
      const session = sessions.get(message?.token);
      if (!session || session.expiresAt < Date.now()) throw Object.assign(new Error('Remote session expired.'), { status: 401 });
      clientKey = publicEncryptionKey(session.claims.clientKey); requestId = message.id;
      if (typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId) || !Number.isSafeInteger(message.expiresAt) || message.expiresAt < Date.now() || message.expiresAt > Date.now() + 90_000) throw Object.assign(new Error('Encrypted request expired.'), { status: 401 });
      for (const [id, expiry] of session.used) if (expiry < Date.now()) session.used.delete(id);
      if (session.used.has(requestId)) throw Object.assign(new Error('Encrypted request was already used.'), { status: 409 });
      if (session.used.size > 3000) throw Object.assign(new Error('Too many requests in this session.'), { status: 429 });
      session.used.set(requestId, message.expiresAt);
      await broker('/v1/devices/authorize', { hostId, workspaceId, deviceId: session.claims.deviceId });
      const value = message.value || {}; let result;
      if (message.operation === 'snapshot') result = await notes.syncSnapshot();
      else if (message.operation === 'changes') result = await notes.syncChanges(value);
      else if (message.operation === 'read') result = await notes.syncRead(value.id);
      else if (message.operation === 'asset') result = await readNoteAsset({ ...value, directory, notes });
      else if (message.operation === 'apply') {
        if (!session.claims.scope.includes('notes:write')) throw Object.assign(new Error('This remote session is read-only.'), { status: 403 });
        result = await notes.syncApply({ ...value, deviceId: session.claims.deviceId });
      } else throw Object.assign(new Error('Notes operation not found.'), { status: 404 });
      await reply(result?.conflict ? 409 : 200, result);
    } catch (error) { if (!response.headersSent) await reply(error.status || 400, { error: error.status ? error.message : 'The Notes operation could not be completed. Reload the latest revision and retry.' }); else response.destroy(); }
    finally { handled = true; release(); }
  };
  // Encrypting an error can itself fail (invalid client key, closed socket).
  const server = createServer((request, response) => { void handle(request, response).catch(() => response.destroy()); });
  server.maxConnections = 16;
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { port: server.address().port, close: () => new Promise(resolve => { sessions.clear(); server.close(resolve); server.closeAllConnections(); }) };
}
