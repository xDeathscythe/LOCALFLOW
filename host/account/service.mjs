import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createAccountVault } from './secure-store.mjs';
import { jsonRequest, serviceUrl } from './http.mjs';
import { createCalendarCache } from './calendar.mjs';
import { createRemoteNotesServer } from '../remote/server.mjs';
import { startManagedTunnel } from '../remote/tunnel.mjs';
import { createRemoteKey, publicEncryptionKey } from '../remote/envelope.mjs';
import { readJsonFile, writeJsonFile } from '../niwa/host/niwa-store.mjs';

export function createAccountService({ directory, notes, openBrowser, notify = () => {}, vault = createAccountVault(directory), fetchImpl = fetch, allowLoopback = false }) {
  const file = join(directory, 'account', 'config.json');
  let settings = readJsonFile(file, { serviceUrl: process.env.LOCALFLOW_ACCOUNT_SERVICE_URL || '', hostId: randomUUID(), workspaceId: randomUUID(), name: hostname(), remoteEnabled: false });
  let credentials, configuration, devices = [], hosts = [], phase = settings.serviceUrl ? 'signed-out' : 'unconfigured', error = '', closed = false;
  let login, remoteServer, tunnel, remoteStatus = 'disabled', remoteError = '', remotePending, refreshing, generation = 0;
  const save = () => writeJsonFile(file, settings);
  const request = (path, body, token = credentials?.token) => {
    if (!settings.serviceUrl) throw new Error('Configure the LocalFlow account service first.');
    return jsonRequest(settings.serviceUrl + path, { body, token, fetchImpl });
  };
  const calendar = createCalendarCache({ directory, request, changed: () => emit() });
  function state() {
    return { status: phase, error, serviceUrl: settings.serviceUrl, configured: Boolean(settings.serviceUrl), user: credentials?.user || null, deviceId: credentials?.deviceId || null, hostId: settings.hostId, workspaceId: settings.workspaceId, name: settings.name, devices, computers: hosts, calendar: calendar.state(), upcoming: calendar.events(), remote: { enabled: settings.remoteEnabled, status: remoteStatus, error: remoteError, endpoint: hosts.find(host => host.id === settings.hostId)?.endpoint || '', managedAvailable: Boolean(configuration?.managedTunnels), cloudflaredPath: settings.cloudflaredPath || '' } };
  }
  function emit() { if (!closed) notify(state()); }
  const hostBody = () => ({ hostId: settings.hostId, workspaceId: settings.workspaceId });
  const cancelLogin = () => { if (login) { clearTimeout(login.timer); login.server.close(); login.server.closeIdleConnections(); login = null; } };
  const stopRemote = async () => { tunnel?.close(); tunnel = null; await remoteServer?.close(); remoteServer = null; remoteStatus = 'disabled'; };
  const startRemote = () => {
    if (remotePending) return remotePending;
    remotePending = (async () => {
      if (!credentials || !settings.remoteEnabled || closed) return;
      const active = credentials;
      if (remoteServer && tunnel) return;
      remoteStatus = 'starting'; remoteError = ''; emit();
      try {
        configuration ||= await request('/v1/config');
        if (closed || credentials !== active || !settings.remoteEnabled) return;
        if (!configuration.managedTunnels) throw new Error('The account service needs managed tunnel configuration before remote Notes can be enabled.');
        remoteServer = await createRemoteNotesServer({ directory, notes, ...hostBody(), ownerId: credentials.user.id, broker: request, configuration, encryptionKey: credentials.encryptionKey });
        const provisioned = await request('/v1/hosts/tunnel', { ...hostBody(), port: remoteServer.port });
        if (closed || credentials !== active || !settings.remoteEnabled) { await stopRemote(); return; }
        tunnel = await startManagedTunnel({ token: provisioned.token, command: settings.cloudflaredPath, changed: update => { remoteStatus = update.status; remoteError = update.error; emit(); } });
        remoteStatus = 'connecting';
      } catch (failure) { await stopRemote(); remoteStatus = 'error'; remoteError = failure.message; }
      emit();
    })().finally(() => { remotePending = null; });
    return remotePending;
  };
  const refresh = () => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      if (!credentials || closed) return;
      const active = credentials, epoch = generation;
      try {
        configuration = await request('/v1/config');
        const [deviceList, hostList] = await Promise.all([request('/v1/devices'), request('/v1/hosts')]);
        if (closed || credentials !== active || epoch !== generation) return;
        devices = deviceList.devices; hosts = hostList.hosts; phase = 'connected'; error = '';
        if (credentials.expiresAt < Date.now() + 7 * 86_400_000) { const renewed = await request('/v1/device/renew', {}); credentials.expiresAt = renewed.expiresAt; await vault.write(credentials); }
        await request('/v1/hosts/heartbeat', { ...hostBody(), online: Boolean(tunnel?.online()) });
        if (closed || credentials !== active || epoch !== generation) return;
        if (settings.remoteEnabled && !tunnel) await startRemote();
        if (!calendar.state().lastSync || Date.now() - Date.parse(calendar.state().lastSync) > 120_000) await calendar.sync();
      } catch (failure) {
        if (closed || credentials !== active || epoch !== generation) return;
        phase = failure.status === 401 || failure.status === 403 ? 'sign-in-required' : 'offline'; error = failure.message;
        if (phase === 'sign-in-required') { await stopRemote(); calendar.clear(); }
      }
      emit();
    })().finally(() => { refreshing = null; });
    return refreshing;
  };
  const ready = (async () => {
    try {
      if (settings.serviceUrl) settings.serviceUrl = serviceUrl(settings.serviceUrl, allowLoopback);
      credentials = await vault.read();
      if (credentials) { calendar.bind(credentials.user.id); phase = 'offline'; }
      save(); emit();
    } catch { phase = 'error'; error = 'Saved account credentials could not be unlocked for this Windows user.'; emit(); }
  })();
  void ready.then(refresh);
  const timer = setInterval(() => { void ready.then(refresh); }, 30_000); timer.unref?.();

  async function signIn() {
    const epoch = ++generation;
    cancelLogin(); phase = 'connecting'; error = ''; emit();
    const verifier = randomBytes(32).toString('base64url'), stateValue = randomBytes(32).toString('base64url');
    const server = createServer(async (requestObject, response) => {
      const url = new URL(requestObject.url, 'http://127.0.0.1');
      if (requestObject.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== stateValue || !login || login.server !== server) { response.writeHead(400); response.end('Invalid sign-in callback.'); return; }
      const attempt = login;
      if (attempt.exchanging) { response.writeHead(409); response.end('Sign-in is already completing.'); return; } attempt.exchanging = true;
      try {
        const result = await request('/v1/login/exchange', { requestId: attempt.requestId, code: url.searchParams.get('code'), verifier }, undefined);
        if (closed || login !== attempt || generation !== epoch) { await request('/v1/devices/revoke', { deviceId: result.deviceId }, result.token); throw new Error('Sign-in was cancelled.'); }
        if (settings.ownerId && (settings.ownerId !== result.user.id || settings.ownerIssuer !== settings.serviceUrl)) {
          await request('/v1/devices/revoke', { deviceId: result.deviceId }, result.token);
          throw new Error('This Notes workspace is linked to a different account. Sign in with its original owner.');
        }
        result.encryptionKey = credentials?.encryptionKey || (await createRemoteKey()).privateKey;
        if (closed || login !== attempt || generation !== epoch) { await request('/v1/devices/revoke', { deviceId: result.deviceId }, result.token); throw new Error('Sign-in was cancelled.'); }
        await request('/v1/hosts/register', { ...hostBody(), name: settings.name, encryptionKey: publicEncryptionKey(result.encryptionKey) }, result.token);
        await stopRemote();
        if (credentials && credentials.deviceId !== result.deviceId) await request('/v1/devices/revoke', { deviceId: credentials.deviceId }, result.token);
        if (closed || login !== attempt || generation !== epoch) { await request('/v1/devices/revoke', { deviceId: result.deviceId }, result.token); throw new Error('Sign-in was cancelled.'); }
        credentials = result; await vault.write(credentials);
        if (closed || login !== attempt || generation !== epoch) { if (credentials === result) { credentials = null; await vault.write(null); } throw new Error('Sign-in was cancelled.'); }
        settings = { ...settings, ownerId: result.user.id, ownerIssuer: settings.serviceUrl }; save();
        calendar.bind(result.user.id); phase = 'connected'; error = '';
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); response.end('LocalFlow is connected. You can return to the app.');
        cancelLogin(); emit(); void refresh();
      } catch (failure) { if (!closed && generation === epoch) { phase = 'error'; error = failure.message; cancelLogin(); emit(); } if (!response.destroyed) { response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); response.end('LocalFlow could not complete sign-in. Return to the app for details.'); } }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (closed || generation !== epoch) { server.close(); return; }
    login = { server, requestId: null, timer: setTimeout(() => { cancelLogin(); phase = credentials ? 'connected' : 'signed-out'; error = 'Sign-in expired. Please try again.'; emit(); }, 10 * 60_000) };
    try {
      const started = await request('/v1/login/start', { challenge: createHash('sha256').update(verifier).digest('base64url'), state: stateValue, redirectUri: `http://127.0.0.1:${server.address().port}/callback`, name: settings.name }, undefined);
      if (closed || generation !== epoch || login?.server !== server) return;
      if (new URL(started.authorizationUrl).origin !== settings.serviceUrl) throw new Error('Account service returned an invalid sign-in destination.');
      login.requestId = started.requestId; await openBrowser(started.authorizationUrl);
    } catch (failure) { if (!closed && generation === epoch) { cancelLogin(); phase = 'error'; error = failure.message; emit(); } throw failure; }
  }

  return {
    state, ready,
    calendarEvents: () => calendar.events(),
    notesChanged() { /* SQLite triggers persist the sync cursor in the same Notes transaction. */ },
    async call(action, value = {}) {
      await ready;
      if (action === 'status') return state();
      if (action === 'configure') {
        ++generation; cancelLogin();
        if (credentials && value.serviceUrl !== undefined && value.serviceUrl !== settings.serviceUrl) throw new Error('Sign out before changing the account service.');
        if (value.serviceUrl !== undefined) settings.serviceUrl = value.serviceUrl ? serviceUrl(value.serviceUrl, allowLoopback) : '';
        if (value.cloudflaredPath !== undefined) { if (typeof value.cloudflaredPath !== 'string' || value.cloudflaredPath.length > 1000) throw new Error('Invalid cloudflared path.'); settings.cloudflaredPath = value.cloudflaredPath; }
        if (value.name !== undefined) { if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 150) throw new Error('Enter a computer name.'); settings.name = value.name.trim(); }
        configuration = null; save(); phase = credentials ? phase : settings.serviceUrl ? 'signed-out' : 'unconfigured'; error = ''; emit();
      } else if (action === 'login') await signIn();
      else if (action === 'cancelLogin') { ++generation; cancelLogin(); phase = credentials ? 'connected' : 'signed-out'; error = ''; emit(); }
      else if (action === 'logout') {
        ++generation;
        cancelLogin(); settings.remoteEnabled = false; save(); await stopRemote();
        const previous = credentials; credentials = null; devices = []; hosts = []; calendar.clear(); await vault.write(null);
        error = ''; if (previous) try { await request('/v1/devices/revoke', { deviceId: previous.deviceId }, previous.token); } catch { error = 'Signed out locally. The service was unreachable; revoke this device from another connected device when online.'; }
        phase = settings.serviceUrl ? 'signed-out' : 'unconfigured'; emit();
      } else if (action === 'refresh') await refresh();
      else if (action === 'calendarSync') await calendar.sync();
      else if (action === 'calendarSelect') await calendar.select(value.ids);
      else if (action === 'calendarEnable') await calendar.enable(value.enabled);
      else if (action === 'remoteEnable') { if (!credentials) throw new Error('Sign in before enabling remote Notes.'); settings.remoteEnabled = true; save(); await startRemote(); }
      else if (action === 'remoteDisable') { settings.remoteEnabled = false; save(); await stopRemote(); if (credentials) await request('/v1/hosts/disable', hostBody()); emit(); }
      else if (action === 'revokeDevice') { if (value.deviceId === credentials?.deviceId) return this.call('logout'); await request('/v1/devices/revoke', { deviceId: value.deviceId }); await refresh(); }
      else throw new Error('Unknown account action.');
      return state();
    },
    async close() { closed = true; ++generation; clearInterval(timer); cancelLogin(); await Promise.allSettled([refreshing, remotePending]); await stopRemote(); },
  };
}
