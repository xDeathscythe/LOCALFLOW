import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createAccountBroker } from '../services/account/server.mjs';
import { createRemoteNotesServer } from '../host/remote/server.mjs';
import { createNotesService } from '../host/notes-service.mjs';
import { createAccountService } from '../host/account/service.mjs';
import { createCalendarCache } from '../host/account/calendar.mjs';
import { createAccountVault } from '../host/account/secure-store.mjs';
import { createRemoteKey, openRemote, sealRemote } from '../host/remote/envelope.mjs';
import { storeUploads } from '../host/notes/uploads.mjs';
import { connectRemoteNotes } from '../host/remote/client.mjs';
import { request as rawHttpRequest } from 'node:http';

const directory = mkdtempSync(join(tmpdir(), 'localflow-account-test-'));
const origin = 'https://accounts.localflow-test.invalid';
const profiles = { alice: { id: 'user-alice', name: 'Alice', email: 'alice@example.invalid' }, bob: { id: 'user-bob', name: 'Bob', email: 'bob@example.invalid' } };
const provider = {
  async authenticate(request) { const key = request.headers.get('authorization')?.replace('Bearer browser-', ''); if (!profiles[key]) throw Object.assign(new Error('Invalid browser session.'), { status: 401 }); return profiles[key]; },
  async calendar(owner, resource) { return resource === 'list' ? { items: [{ id: `${owner}-primary`, primary: true, summary: 'Primary' }] } : { items: [{ id: 'event-1', summary: 'Team conversation', start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date(Date.now() + 600_000).toISOString() } }], nextSyncToken: 'sync-1' }; },
};
const broker = await createAccountBroker({ directory: join(directory, 'broker'), origin, provider, publishableKey: 'pk_test_' + Buffer.from('fixture.clerk.accounts.dev$').toString('base64'), provisionTunnel: async ({ hostId }) => ({ tunnelId: 'fixture-tunnel', endpoint: `https://${hostId}.remote.invalid`, token: 'fixture-private-tunnel-token' }) });
await new Promise(resolve => broker.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${broker.server.address().port}`;
const http = async (endpoint, path, body, token, expected = 200) => {
  const response = await fetch(endpoint + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`); return data;
};
const api = (path, body, token, expected) => http(base, path, body, token, expected);
const signIn = async (user, name = 'Device') => {
  const verifier = randomBytes(32).toString('base64url');
  const start = await api('/v1/login/start', { name, state: randomBytes(32).toString('base64url'), redirectUri: 'http://127.0.0.1:45678/callback', challenge: createHash('sha256').update(verifier).digest('base64url') });
  const completed = await api('/v1/login/complete', { requestId: start.requestId }, `browser-${user}`);
  const code = new URL(completed.redirectUri).searchParams.get('code');
  await api('/v1/login/exchange', { requestId: start.requestId, verifier: randomBytes(32).toString('base64url'), code }, undefined, 401);
  const result = await api('/v1/login/exchange', { requestId: start.requestId, verifier, code });
  await api('/v1/login/exchange', { requestId: start.requestId, verifier, code }, undefined, 401);
  return result;
};
const notes = createNotesService(join(directory, 'workspace'), () => {});
const hostKeys = await createRemoteKey(), clientKeys = await createRemoteKey();
let lastEncrypted;
const remoteHttp = async (endpoint, path, body, token, expected = 200) => {
  let wire, route, nonce;
  if (path === '/v1/session') {
    nonce = randomUUID();
    wire = { ticket: body.ticket, envelope: await sealRemote({ nonce, ticketId: JSON.parse(Buffer.from(body.ticket.split('.')[1], 'base64url')).jti }, hostKeys.publicKey) }; route = path;
  } else if (!token) return http(endpoint, path, body, token, expected);
  else {
    const url = new URL(path, endpoint), operation = url.pathname.split('/').at(-1);
    const value = operation === 'apply' ? body : operation === 'changes' ? { cursor: Number(url.searchParams.get('cursor')) } : operation === 'asset' ? Object.fromEntries(url.searchParams) : { id: url.searchParams.get('id') };
    nonce = randomUUID(); wire = { envelope: await sealRemote({ id: nonce, token, operation, value, expiresAt: Date.now() + 60_000 }, hostKeys.publicKey) }; route = '/v1/notes/request'; lastEncrypted = wire;
    assert.ok(!JSON.stringify(wire).includes('Original'));
  }
  const response = await fetch(endpoint + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(wire) });
  const payload = await response.json();
  assert.ok(!JSON.stringify(payload).includes('Merged on phone'));
  const result = payload.envelope ? await openRemote(payload.envelope, clientKeys.privateKey) : { value: payload, status: response.status };
  assert.equal(response.status, expected, JSON.stringify(result));
  if (payload.envelope) assert.equal(result.requestId, nonce);
  return result.value;
};
let remote, account;
try {
  await api('/v1/login/start', { name: 'Bad', state: randomBytes(32).toString('base64url'), challenge: randomBytes(32).toString('base64url'), redirectUri: 'https://attacker.invalid/callback' }, undefined, 400);
  const [desktop, mobile, wrongOwner] = await Promise.all([signIn('alice', 'Home PC'), signIn('alice', 'Phone'), signIn('bob')]);
  const identity = { hostId: randomUUID(), workspaceId: randomUUID() };
  await api('/v1/hosts/register', { ...identity, name: 'Home PC', encryptionKey: hostKeys.publicKey }, desktop.token);
  await api('/v1/hosts/register', { ...identity, name: 'Hijack' }, wrongOwner.token, 403);
  await api('/v1/hosts/tunnel', { ...identity, port: 34567 }, desktop.token);
  await api('/v1/hosts/heartbeat', { ...identity, online: true }, desktop.token);
  assert.equal((await api('/v1/hosts', undefined, desktop.token)).hosts[0].online, true);
  assert.equal((await api('/v1/hosts', undefined, wrongOwner.token)).hosts.length, 0);
  const ownList = await api('/v1/devices', undefined, desktop.token);
  assert.ok(!JSON.stringify(ownList).includes(desktop.token));
  assert.ok(!JSON.stringify(ownList).includes('token_hash'));
  await api('/v1/tickets', { ...identity, permission: 'write' }, wrongOwner.token, 403);
  await api('/v1/tickets', { ...identity, workspaceId: randomUUID(), permission: 'write' }, mobile.token, 403);
  const configuration = await api('/v1/config');
  assert.ok(!JSON.stringify(configuration).includes('PRIVATE KEY'));
  let holdAuthorization = false, reachedCapacity;
  const held = [], atCapacity = new Promise(resolve => { reachedCapacity = resolve; });
  const brokerRequest = async (path, body) => {
    if (holdAuthorization && path === '/v1/devices/authorize') await new Promise(resolve => { held.push(resolve); if (held.length === 2) reachedCapacity(); });
    const response = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${desktop.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status }); return value;
  };
  remote = await createRemoteNotesServer({ directory: join(directory, 'workspace'), notes, ...identity, ownerId: desktop.user.id, broker: brokerRequest, configuration, encryptionKey: hostKeys.privateKey });
  const endpoint = `http://127.0.0.1:${remote.port}`;
  await remoteHttp(endpoint, '/v1/notes/snapshot', undefined, undefined, 401);
  const ticket = (await api('/v1/tickets', { ...identity, permission: 'write', clientKey: clientKeys.publicKey }, mobile.token)).ticket;
  const session = await remoteHttp(endpoint, '/v1/session', { ticket });
  holdAuthorization = true;
  const concurrent = [remoteHttp(endpoint, '/v1/notes/snapshot', undefined, session.token), remoteHttp(endpoint, '/v1/notes/snapshot', undefined, session.token)];
  await atCapacity; await http(endpoint, '/health', undefined, undefined, 429);
  holdAuthorization = false; held.forEach(release => release()); await Promise.all(concurrent);
  const oversizedStatus = await new Promise((resolve, reject) => {
    const request = rawHttpRequest(endpoint + '/v1/notes/request', { method: 'POST', headers: { 'content-length': 16_000_001 } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(oversizedStatus, 413);
  const brokenKeyTicket = (await api('/v1/tickets', { ...identity, permission: 'read', clientKey: { kty: 'RSA', n: 'A'.repeat(342), e: 'AQAB' } }, mobile.token)).ticket;
  const brokenEnvelope = await sealRemote({ nonce: randomUUID(), ticketId: JSON.parse(Buffer.from(brokenKeyTicket.split('.')[1], 'base64url')).jti }, hostKeys.publicKey);
  await assert.rejects(fetch(endpoint + '/v1/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: brokenKeyTicket, envelope: brokenEnvelope }) }));
  assert.equal((await http(endpoint, '/health')).name, 'LocalFlow Notes');
  await remoteHttp(endpoint, '/v1/session', { ticket }, undefined, 401);
  const chunks = ticket.split('.'); chunks[1] = Buffer.from(JSON.stringify({ sub: 'user-bob' })).toString('base64url');
  await remoteHttp(endpoint, '/v1/session', { ticket: chunks.join('.') }, undefined, 401);
  const snapshot = await remoteHttp(endpoint, '/v1/notes/snapshot', undefined, session.token);
  assert.equal(snapshot.directory, undefined);
  const edit = { operationId: randomUUID(), operation: 'create', value: { label: 'Meeting', content: 'Original', kind: 'note' }, treeRevision: snapshot.treeRevision };
  const created = await remoteHttp(endpoint, '/v1/notes/apply', edit, session.token);
  assert.equal(created.value.path, undefined);
  assert.deepEqual(await remoteHttp(endpoint, '/v1/notes/apply', edit, session.token), created);
  await remoteHttp(endpoint, '/v1/notes/apply', { ...edit, value: { ...edit.value, content: 'Different operation' } }, session.token, 400);
  const local = await notes.read(created.value.id);
  await notes.save({ ...local, content: 'Changed on desktop' });
  const conflict = await remoteHttp(endpoint, '/v1/notes/apply', { operationId: randomUUID(), operation: 'save', value: { ...created.value, content: 'Changed on phone' } }, session.token, 409);
  assert.equal(conflict.conflict, true); assert.equal(conflict.current.content, 'Changed on desktop');
  const accepted = await remoteHttp(endpoint, '/v1/notes/apply', { operationId: randomUUID(), operation: 'save', value: { ...conflict.current, content: 'Merged on phone' } }, session.token);
  assert.equal((await notes.read(created.value.id)).content, 'Merged on phone');
  const repeatedEnvelope = await http(endpoint, '/v1/notes/request', lastEncrypted, undefined, 409);
  assert.match((await openRemote(repeatedEnvelope.envelope, clientKeys.privateKey)).value.error, /already used/);
  const asset = (await storeUploads(join(directory, 'workspace', 'notes'), [{ name: 'meeting.bin', data: Buffer.alloc(1_048_580, 67) }]))[0];
  const noteWithAsset = await notes.read(created.value.id); await notes.save({ ...noteWithAsset, content: `Attachment: ${asset.url}` });
  const assetTicket = (await api('/v1/tickets', { ...identity, permission: 'read', clientKey: clientKeys.publicKey }, mobile.token)).ticket;
  const actualClient = await connectRemoteNotes({ endpoint, ticket: assetTicket, clientKey: clientKeys.privateKey, hostKey: hostKeys.publicKey });
  const assetChunk = await actualClient.request('asset', { noteId: created.value.id, url: asset.url });
  assert.equal(assetChunk.status, 200); assert.equal(assetChunk.value.nextOffset, 1_048_576);
  assert.equal(Buffer.from(assetChunk.value.data, 'base64')[0], 67);
  const assetTail = await actualClient.request('asset', { noteId: created.value.id, url: asset.url, offset: assetChunk.value.nextOffset, etag: assetChunk.value.etag });
  assert.equal(Buffer.from(assetTail.value.data, 'base64').length, 4);
  assert.equal((await actualClient.request('asset', { noteId: created.value.id, url: asset.url, offset: 1, etag: 'wrong' })).status, 412);
  assert.equal((await actualClient.request('asset', { noteId: created.value.id, url: 'file:///C:/Windows/win.ini' })).status, 400);
  const reconnectTicket = (await api('/v1/tickets', { ...identity, permission: 'read', clientKey: clientKeys.publicKey }, mobile.token)).ticket;
  const reconnect = await remoteHttp(endpoint, '/v1/session', { ticket: reconnectTicket });
  const changes = await remoteHttp(endpoint, `/v1/notes/changes?cursor=${snapshot.cursor}`, undefined, reconnect.token);
  assert.ok(changes.changes.some(change => change.id === created.value.id));
  await remoteHttp(endpoint, '/v1/notes/apply', { ...edit, operationId: randomUUID() }, reconnect.token, 403);
  await notes.remove(created.value.id);
  const tombstones = await remoteHttp(endpoint, `/v1/notes/changes?cursor=${accepted.cursor}`, undefined, reconnect.token);
  assert.ok(tombstones.changes.some(change => change.id === created.value.id && change.deleted === 1));
  await api('/v1/devices/revoke', { deviceId: mobile.deviceId }, desktop.token);
  await remoteHttp(endpoint, '/v1/notes/snapshot', undefined, reconnect.token, 403);
  await api('/v1/tickets', { ...identity, permission: 'read' }, mobile.token, 401);
  await api('/v1/devices/revoke', { deviceId: desktop.deviceId }, wrongOwner.token, 404);
  await api('/v1/hosts/disable', identity, desktop.token);
  assert.equal((await api('/v1/hosts', undefined, desktop.token)).hosts[0].online, false);

  let cached = null, browserUser = 'alice', offline = false;
  account = createAccountService({ directory: join(directory, 'desktop'), notes, vault: { read: async () => cached, write: async value => { cached = value; } }, fetchImpl: (url, options) => { if (offline) throw new Error('Offline'); return fetch(String(url).replace(origin, base), options); }, openBrowser: async destination => {
    const requestId = new URL(destination).searchParams.get('request');
    const result = await api('/v1/login/complete', { requestId }, `browser-${browserUser}`);
    const response = await fetch(result.redirectUri); assert.equal(response.status, browserUser === 'alice' ? 200 : 400);
  } });
  await account.call('configure', { serviceUrl: origin });
  await account.call('login');
  await account.call('refresh');
  assert.equal(account.state().user.id, profiles.alice.id);
  assert.equal(account.state().calendar.selected.length, 1);
  assert.ok(!JSON.stringify(account.state()).includes(cached.token));
  assert.equal(account.calendarEvents()[0].id, 'event-1');
  offline = true; await account.call('logout');
  assert.equal(cached, null); assert.equal(account.state().user, null); assert.equal(account.calendarEvents().length, 0); assert.match(account.state().error, /Signed out locally/);
  offline = false;
  browserUser = 'bob'; await account.call('login');
  assert.equal(account.state().user, null); assert.match(account.state().error, /different account/);
  await account.close(); account = null;
  let announce, releaseStart, opened = false;
  const reachedStart = new Promise(resolve => { announce = resolve; });
  account = createAccountService({ directory: join(directory, 'cancelled'), notes, vault: { read: async () => null, write: async () => {} }, openBrowser: async () => { opened = true; }, fetchImpl: async () => { announce(); return new Promise(resolve => { releaseStart = resolve; }); } });
  await account.call('configure', { serviceUrl: origin });
  const pendingLogin = account.call('login'); await reachedStart; await account.call('cancelLogin');
  releaseStart(new Response(JSON.stringify({ requestId: randomUUID(), authorizationUrl: origin + '/connect?request=fixture' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  await pendingLogin; assert.equal(opened, false); assert.equal(account.state().status, 'signed-out'); await account.close(); account = null;

  let expired = false, requests = [];
  const calendar = createCalendarCache({ directory: join(directory, 'calendar'), request: async (path, query) => {
    requests.push({ path, query });
    if (path.endsWith('/list')) return { items: [{ id: 'primary', primary: true }] };
    if (query.syncToken && expired) throw Object.assign(new Error('Expired'), { status: 410 });
    return { items: [{ id: 'one', summary: expired ? 'Refreshed' : 'Initial', start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date(Date.now() + 60_000).toISOString() } }], nextSyncToken: 'token' };
  } });
  calendar.bind('user-alice'); await calendar.sync(); expired = true; await calendar.sync();
  assert.equal(calendar.events()[0].summary, 'Refreshed'); assert.ok(requests.some(item => item.query?.syncToken));
  calendar.bind('user-bob'); assert.equal(calendar.events().length, 0);
  let releaseCalendar;
  const changingOwner = createCalendarCache({ directory: join(directory, 'calendar-race'), request: async () => new Promise(resolve => { releaseCalendar = resolve; }) });
  changingOwner.bind('user-alice'); const oldSync = changingOwner.sync(); changingOwner.bind('user-bob');
  releaseCalendar({ items: [{ id: 'alice-calendar', primary: true }] }); await oldSync;
  assert.equal(changingOwner.state().calendars.length, 0);
  let persistent = createNotesService(join(directory, 'restart'), () => {});
  const firstTree = await persistent.syncSnapshot(), persistentOperation = { deviceId: 'fixture-device', operationId: randomUUID(), operation: 'create', value: { kind: 'note', label: 'Crash-safe', content: 'Saved once' }, treeRevision: firstTree.treeRevision };
  const firstResult = await persistent.syncApply(persistentOperation); await persistent.close();
  persistent = createNotesService(join(directory, 'restart'), () => {});
  assert.deepEqual(await persistent.syncApply(persistentOperation), firstResult); assert.equal((await persistent.list()).items.length, 1); await persistent.close();
  if (process.platform === 'win32') {
    const vault = createAccountVault(join(directory, 'dpapi'));
    await vault.write({ token: 'secret-only-for-dpapi-test' });
    assert.ok(!readFileSync(join(directory, 'dpapi', 'account', 'credentials.json'), 'utf8').includes('secret-only-for-dpapi-test'));
    assert.equal((await vault.read()).token, 'secret-only-for-dpapi-test'); await vault.write(null); assert.equal(await vault.read(), null);
  }
  console.log('ACCOUNT_REMOTE_OK: PKCE, ownership, one-use tickets, JWE encryption/replay, revocation, Notes conflict/retry/tombstones/restart, encrypted attachment resume, Calendar reset, DPAPI.');
} finally {
  await account?.close(); await remote?.close(); await notes.close(); await broker.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe test cleanup path.');
  rmSync(directory, { recursive: true, force: true });
}
