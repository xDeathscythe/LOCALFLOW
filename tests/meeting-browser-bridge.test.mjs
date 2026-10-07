import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createBrowserBridge } from '../host/meetings/browser-bridge.mjs';

test('loopback detector pairs one extension, validates credentials and offers only structured calls', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'localflow-browser-'));
  const received = [];
  const origin = `chrome-extension://${'a'.repeat(32)}`, other = `chrome-extension://${'b'.repeat(32)}`;
  let bridge;
  try {
    bridge = await createBrowserBridge({ directory, port: 0, onEvent: event => received.push(event), getSources: async () => ({ sessions: [
      { application: 'chrome.exe', processId: 42, source: 'microphone', active: true, deviceId: 'mic-1' },
      { application: 'chrome.exe', processId: 42, source: 'remote', active: true },
    ] }) });
    const post = async (route, body, token, from = origin, extra = {}) => {
      if (extra.Host) return new Promise((resolve, reject) => {
        const request = http.request({ hostname:'127.0.0.1',port:bridge.status().port,path:`/v1/${route}`,method:'POST',headers:{Origin:from,'Content-Type':'application/json',Authorization:`Bearer ${token}`,...extra}}, response => {
          let text=''; response.setEncoding('utf8'); response.on('data',data=>{text+=data;}); response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(text)}));
        }); request.on('error',reject); request.end(JSON.stringify(body));
      });
      const response = await fetch(`http://127.0.0.1:${bridge.status().port}/v1/${route}`, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const pairing = JSON.parse(Buffer.from(bridge.pair().code.slice(10), 'base64url').toString());
    assert.equal((await post('pair', { secret: 'wrong' })).status, 403);
    assert.equal((await post('pair', { secret: pairing.secret }, null, 'https://meet.google.com')).status, 403);
    const linked = await post('pair', { secret: pairing.secret });
    assert.equal(linked.status, 200); const token = linked.body.token;
    assert.equal((await post('pair', { secret: pairing.secret })).status, 403, 'Pair code is one use');
    const call = { state: 'connected', site: 'https://meet.google.com', conferenceId:'abc-defg-hij', browser: 'chrome', pageId: 'page-1', callId: 'call-1', sequence: 1, observedAt: Date.now(), inboundPackets: 8, outboundPackets: 10 };
    assert.equal((await post('events', call, 'wrong')).status, 401);
    assert.equal((await post('events', call, token, other)).status, 403);
    assert.equal((await post('events', { ...call, site: 'https://unrelated.example' }, token)).status, 400);
    assert.equal((await post('events', { ...call, observedAt: Date.now() - 60_000 }, token)).status, 400);
    assert.equal((await post('events', { ...call, inboundPackets: 0 }, token)).status, 400, 'Mic only activity cannot confirm a call');
    assert.equal((await post('events', call, token, origin, { Host: 'attacker.example' })).status, 403, 'Host prevents rebinding');
    assert.equal((await post('events', call, token)).status, 200);
    assert.equal(received.length, 1); assert.equal(received[0].confirmedCall, true); assert.equal(received[0].processId, 42);
    assert.equal(received[0].microphoneDeviceId, 'mic-1');
    assert.equal(received[0].conferenceId,'abc-defg-hij');
    await post('events', call, token);
    await post('events', { ...call, sequence: 2 }, token);
    assert.equal(received.length, 1, 'Repeated heartbeat does not create another offer');
    await post('events', { ...call, sequence: 3, state: 'ended' }, token);
    assert.equal(received[1].type, 'call-ended');
    await post('events', { ...call, sequence: 4 }, token);
    assert.equal(received.length, 2, 'Ended call IDs cannot be replayed');
    bridge.disconnect();
    assert.equal((await post('events', call, token)).status, 403);
    assert.equal(bridge.status().paired, false);
  } finally { await bridge?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('browser process mapping remains unresolved when multiple applications match', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'localflow-browser-'));
  const events = [];
  const bridge = await createBrowserBridge({ directory, port: 0, onEvent: event => events.push(event), getSources: async () => ({ sessions: [
    { application: 'chrome.exe', processId: 1, active: true }, { application: 'chrome.exe', processId: 2, active: true },
  ] }) });
  try {
    const code = JSON.parse(Buffer.from(bridge.pair().code.slice(10), 'base64url'));
    const base = `http://127.0.0.1:${bridge.status().port}/v1/`, headers = { Origin: `chrome-extension://${'c'.repeat(32)}`, 'Content-Type': 'application/json' };
    const pair = await (await fetch(`${base}pair`, { method: 'POST', headers, body: JSON.stringify({ secret: code.secret }) })).json();
    await fetch(`${base}events`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${pair.token}` }, body: JSON.stringify({ state: 'connected', site: 'https://teams.microsoft.com', browser: 'chrome', pageId: 'p', callId: 'c', sequence: 1, observedAt: Date.now(), inboundPackets: 1, outboundPackets: 1 }) });
    assert.equal(events.length, 1); assert.equal(events[0].processId, undefined);
  } finally { await bridge.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('real detector hook ignores voice notes and disconnected RTP then observes two-way audio lifecycle', async () => {
  const posts = [], intervals = [], listeners = new Map();
  let time = 100_000;
  class Peer {
    constructor() { this.connectionState = 'new'; this.iceConnectionState = 'new'; this.incoming = 0; this.outgoing = 0; }
    addEventListener() {}
    async getStats() { return new Map([
      ['in', { kind: 'audio', type: 'inbound-rtp', packetsReceived: this.incoming }],
      ['out', { kind: 'audio', type: 'outbound-rtp', packetsSent: this.outgoing }],
    ]); }
  }
  const window = { RTCPeerConnection: Peer, postMessage: value => posts.push(value), addEventListener: (name, handler) => listeners.set(name, handler) };
  window.top = window;
  const context = vm.createContext({ window, crypto: { randomUUID }, location: { origin: 'https://meet.google.com' }, Date: { now: () => time },
    setInterval: handler => { intervals.push(handler); return intervals.length; }, clearInterval() {}, Proxy, Reflect, Set });
  vm.runInContext(readFileSync(new URL('../extensions/meeting-detection/detector.js', import.meta.url), 'utf8'), context);
  const tick = async () => { for (const handler of intervals) handler(); await new Promise(resolve => setImmediate(resolve)); time += 1000; };
  await tick(); assert.equal(posts.length, 0, 'No peer connection means no offer regardless of a voice recorder');
  const peer = new window.RTCPeerConnection(); peer.incoming = 4; peer.outgoing = 4;
  await tick(); assert.equal(posts.length, 0, 'Unconnected RTP does not qualify');
  peer.connectionState = 'connected'; peer.incoming = 0;
  await tick(); assert.equal(posts.length, 0, 'Outgoing-only audio does not qualify');
  peer.incoming = 8; peer.outgoing = 8; await tick();
  assert.equal(posts[0].state, 'connected'); const callId = posts[0].callId;
  peer.connectionState = 'disconnected';
  for (let index = 0; index < 7; index++) await tick();
  assert.equal(posts.some(value => value.state === 'ended'), false, 'A recoverable transport interruption must not stop recording');
  peer.connectionState = 'closed';
  for (let index = 0; index < 7; index++) await tick();
  assert.equal(posts.at(-1).state, 'ended'); assert.equal(posts.at(-1).callId, callId);
  assert.equal(posts.some(value => 'audio' in value || 'title' in value || 'token' in value), false);
});
