// Isolated browser/IPC mocks only: node --test tests/niwa-voice.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(path.join(__dirname, '../src/lib/niwa.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

class Track {
  kind = 'audio'; enabled = true; muted = false; readyState = 'live'; stops = 0;
  stop() { this.stops++; this.readyState = 'ended'; }
  end() { this.readyState = 'ended'; this.onended?.(); }
}
class Stream {
  constructor(tracks = [new Track()]) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
}

function harness() {
  const h = { peers: [], audios: [], requests: [], starts: [], stops: [], events: [], errors: [], activity: [], peerPlans: [] };
  class Audio {
    srcObject = null; pauses = 0; plays = 0;
    constructor() { h.audios.push(this); }
    pause() { this.pauses++; }
    play() { this.plays++; return Promise.resolve(); }
  }
  class Peer {
    connectionState = 'new'; signalingState = 'stable'; localDescription = null; closed = false;
    localCalls = []; remoteCalls = []; replacements = []; transceivers = [];
    constructor() {
      this.plan = h.peerPlans.shift() ?? {};
      this.sender = { track: null, replaceTrack: track => {
        this.replacements.push(track);
        return Promise.resolve(this.plan.replace?.(track)).then(() => { this.sender.track = track; });
      } };
      h.peers.push(this);
    }
    addTransceiver(kind, options) { this.transceivers.push({ kind, ...options }); return { sender: this.sender }; }
    createDataChannel(label) { this.channel = label; }
    createOffer() { return this.plan.offer?.() ?? Promise.resolve({ type: 'offer', sdp: `offer-${h.peers.indexOf(this)}` }); }
    async setLocalDescription(offer) {
      this.localCalls.push(offer);
      await this.plan.local?.();
      this.localDescription = offer; this.signalingState = 'have-local-offer';
    }
    async setRemoteDescription(answer) {
      this.remoteCalls.push(answer);
      await this.plan.remote?.();
      this.signalingState = 'stable';
    }
    close() { this.closed = true; this.connectionState = 'closed'; }
  }
  const context = vm.createContext({ exports: {}, Error, Audio, MediaStream: Stream, RTCPeerConnection: Peer,
    navigator: { mediaDevices: { getUserMedia: constraints => {
      const request = deferred(); request.constraints = constraints; h.requests.push(request); return request.promise;
    } } },
    window: { localflow: {
      niwaStartVoice: sdp => { h.starts.push(sdp); h.events.push(`start:${sdp}`); return h.start?.(sdp) ?? Promise.resolve(); },
      niwaStopVoice: () => { h.stops.push(true); h.events.push('stop'); return h.stop?.() ?? Promise.resolve(); },
    } },
  });
  vm.runInContext(source, context, { filename: 'niwa.ts' });
  h.voice = new context.exports.NiwaVoice(message => h.errors.push(message), active => h.activity.push(active));
  h.capture = async (stream = new Stream()) => {
    const task = h.voice.setMicrophoneEnabled(true);
    h.requests.at(-1).resolve(stream);
    await task;
    return stream;
  };
  return h;
}

function stopped(stream) {
  for (const track of stream.getTracks()) { assert.equal(track.enabled, false); assert.equal(track.readyState, 'ended'); }
}

test('default start receives audio without requesting a microphone; release preserves output and session', async () => {
  const h = harness();
  await h.voice.start();
  const peer = h.peers[0], audio = h.audios[0], output = new Stream();
  assert.equal(h.requests.length, 0);
  assert.deepEqual(peer.transceivers, [{ kind: 'audio', direction: 'sendrecv' }]);
  assert.equal(peer.channel, 'oai-events');
  await h.voice.answer('answer');
  assert.equal(peer.remoteCalls[0].sdp, 'answer');
  peer.ontrack({ streams: [output] });
  const pauses = audio.pauses;
  const first = await h.capture(new Stream([new Track(), new Track()]));
  const released = h.voice.setMicrophoneEnabled(false);
  stopped(first); // Deliberately before awaiting detach.
  assert.equal(peer.replacements.at(-1), null);
  assert.deepEqual(h.activity, [true, false]);
  assert.equal(audio.srcObject, output);
  assert.equal(audio.pauses, pauses);
  assert.equal(peer.closed, false);
  assert.equal(h.stops.length, 0);
  await released;
  assert.equal(peer.sender.track, null);
  const second = await h.capture();
  assert.notEqual(second, first);
  assert.equal(h.requests.length, 2);
  assert.equal(h.peers.length, 1);
  assert.equal(h.starts.length, 1);
  assert.equal(peer.sender.track, second.getAudioTracks()[0]);
  h.voice.close(); stopped(second); assert.equal(audio.srcObject, null);
});

test('desired microphone may precede start; permission does not delay SDP', async () => {
  const h = harness();
  await h.voice.setMicrophoneEnabled(true);
  assert.equal(h.requests.length, 0);
  await h.voice.start();
  assert.equal(h.starts.length, 1);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.activity, []);
  const stream = new Stream(); h.requests[0].resolve(stream);
  await tick();
  assert.deepEqual(h.activity, [true]);
  assert.equal(h.peers[0].sender.track, stream.getAudioTracks()[0]);
  h.voice.close();
});

test('release before start cancels desired capture', async () => {
  const h = harness();
  await h.voice.setMicrophoneEnabled(true);
  await h.voice.setMicrophoneEnabled(false);
  await h.voice.start();
  assert.equal(h.requests.length, 0);
  h.voice.close();
});

test('late getUserMedia after release is stopped without attachment or active notification', async () => {
  const h = harness(); await h.voice.start();
  const opening = h.voice.setMicrophoneEnabled(true);
  assert.equal(h.voice.setMicrophoneEnabled(true), opening);
  assert.equal(h.requests.length, 1);
  await h.voice.setMicrophoneEnabled(false);
  const stale = new Stream([new Track(), new Track()]); h.requests[0].resolve(stale);
  await opening;
  stopped(stale); assert.deepEqual(h.activity, []);
  assert.equal(h.peers[0].sender.track, null);
  h.voice.close();
});

for (const staleFirst of [true, false]) test(`repress uses fresh capture when stale acquisition resolves ${staleFirst ? 'first' : 'last'}`, async () => {
  const h = harness(); await h.voice.start();
  const first = h.voice.setMicrophoneEnabled(true);
  await h.voice.setMicrophoneEnabled(false);
  const second = h.voice.setMicrophoneEnabled(true);
  const stale = new Stream(), fresh = new Stream();
  if (staleFirst) { h.requests[0].resolve(stale); await first; }
  h.requests[1].resolve(fresh); await second;
  if (!staleFirst) { h.requests[0].resolve(stale); await first; }
  stopped(stale); assert.equal(fresh.getTracks()[0].readyState, 'live');
  assert.equal(h.peers[0].sender.track, fresh.getAudioTracks()[0]);
  assert.deepEqual(h.activity, [true]); h.voice.close();
});

test('close/restart invalidates an acquisition and old peer callbacks', async () => {
  const h = harness(); await h.voice.start();
  const pending = h.voice.setMicrophoneEnabled(true), oldPeer = h.peers[0];
  const oldTrack = oldPeer.ontrack, oldState = oldPeer.onconnectionstatechange;
  h.voice.close(); await h.voice.start();
  const fresh = await h.capture(), stale = new Stream();
  h.requests[0].resolve(stale); await pending;
  oldTrack({ streams: [new Stream()] }); oldPeer.connectionState = 'failed'; oldState();
  stopped(stale); assert.equal(h.audios[0].srcObject, null);
  assert.equal(h.peers[1].sender.track, fresh.getTracks()[0]);
  assert.equal(h.peers[1].closed, false); assert.deepEqual(h.errors, []);
  h.voice.close();
});

test('queued replacements cannot reopen released tracks or overwrite the latest hold', async () => {
  const h = harness(), blocked = deferred();
  let firstReplace = true;
  h.peerPlans.push({ replace: () => { if (firstReplace) { firstReplace = false; return blocked.promise; } } });
  await h.voice.start();
  const first = h.voice.setMicrophoneEnabled(true), a = new Stream(); h.requests[0].resolve(a); await tick();
  assert.deepEqual(h.activity, [true]); // Actual capture, even while attachment is pending.
  const releaseA = h.voice.setMicrophoneEnabled(false); stopped(a);
  const second = h.voice.setMicrophoneEnabled(true), b = new Stream(); h.requests[1].resolve(b); await tick();
  const releaseB = h.voice.setMicrophoneEnabled(false); stopped(b);
  const third = h.voice.setMicrophoneEnabled(true), c = new Stream(); h.requests[2].resolve(c); await tick();
  assert.equal(h.peers[0].replacements.length, 1);
  blocked.resolve(); await Promise.all([first, releaseA, second, releaseB, third]);
  assert.equal(h.peers[0].sender.track, c.getTracks()[0]);
  assert.equal(h.peers[0].replacements.includes(b.getTracks()[0]), false);
  assert.deepEqual(h.activity, [true, false, true, false, true]);
  h.voice.close();
});

for (const stage of ['offer', 'local', 'remote']) test(`restart during ${stage} ignores stale SDP failure`, async () => {
  const h = harness(), blocked = deferred(); h.peerPlans.push({ [stage]: () => blocked.promise });
  let old;
  if (stage === 'remote') { await h.voice.start(); old = h.voice.answer('old'); }
  else { old = h.voice.start(); await tick(); }
  await h.voice.start();
  blocked.reject(new Error('old SDP failed')); await old;
  assert.equal(h.peers[0].closed, true); assert.equal(h.peers[1].closed, false);
  assert.deepEqual(h.errors, []);
  if (stage === 'offer') assert.equal(h.peers[0].localCalls.length, 0);
  h.voice.close();
});

test('close during createOffer never sets SDP or starts backend', async () => {
  const h = harness(), offer = deferred(); h.peerPlans.push({ offer: () => offer.promise });
  const start = h.voice.start(); h.voice.close();
  offer.resolve({ type: 'offer', sdp: 'late' }); await start;
  assert.equal(h.peers[0].localCalls.length, 0); assert.equal(h.starts.length, 0);
});

test('backend start and stale cleanup finish before restart reaches backend', async () => {
  const h = harness(), pending = deferred();
  h.start = sdp => sdp === 'offer-0' ? pending.promise : Promise.resolve();
  const first = h.voice.start(); await tick();
  const second = h.voice.start(); await tick();
  assert.equal(h.starts.length, 1);
  pending.resolve(); await Promise.all([first, second]);
  assert.deepEqual(h.events, ['start:offer-0', 'stop', 'start:offer-1']);
  assert.equal(h.peers[1].closed, false); h.voice.close();
});

for (const stage of ['offer', 'local', 'remote', 'backend']) test(`${stage} failure cleans capture and reports the error`, async () => {
  const h = harness(), blocked = deferred();
  if (stage === 'backend') h.start = () => blocked.promise;
  else h.peerPlans.push({ [stage]: () => blocked.promise });
  let operation;
  if (stage === 'remote') { await h.voice.start(); operation = h.voice.answer('bad'); }
  else operation = h.voice.start();
  const stream = await h.capture();
  blocked.reject(new Error(`${stage} failed`));
  await assert.rejects(operation, new RegExp(`${stage} failed`)); await tick();
  stopped(stream); assert.equal(h.peers[0].closed, true);
  assert.deepEqual(h.activity, [true, false]); assert.match(h.errors[0], /failed/);
});

test('capture denial and attachment failures are observed, reported, and recoverable', async () => {
  const h = harness(); await h.voice.start();
  void h.voice.setMicrophoneEnabled(true);
  h.requests[0].reject(new Error('permission denied')); await tick();
  assert.deepEqual(h.activity, []); assert.match(h.errors[0], /permission denied/);
  h.peers[0].plan.replace = track => { if (track) throw new Error('attachment failed'); };
  const stream = new Stream(), failed = h.voice.setMicrophoneEnabled(true);
  h.requests[1].resolve(stream); await assert.rejects(failed, /attachment failed/); await tick();
  stopped(stream); assert.deepEqual(h.activity, [true, false]);
  assert.equal(h.peers[0].sender.track, null); assert.equal(h.peers[0].closed, false);
  delete h.peers[0].plan.replace; await h.capture(); h.voice.close();
});

test('connection failure stops capture immediately and observes rejected backend stop', async () => {
  const h = harness(); await h.voice.start(); const stream = await h.capture();
  h.stop = () => Promise.reject(new Error('stop failed'));
  h.peers[0].connectionState = 'failed'; h.peers[0].onconnectionstatechange();
  stopped(stream); assert.deepEqual(h.activity, [true, false]);
  await tick(); assert.equal(h.stops.length, 1);
  assert.match(h.errors[0], /Voice connection failed/); assert.match(h.errors[1], /stop failed/);
});

test('hardware mute and end report actual capture and a new hold reacquires', async () => {
  const h = harness(); await h.voice.start(); const stream = await h.capture(), track = stream.getTracks()[0];
  track.muted = true; track.onmute(); track.muted = false; track.onunmute(); track.end();
  stopped(stream); assert.deepEqual(h.activity, [true, false, true, false]);
  await tick(); assert.equal(h.peers[0].sender.track, null);
  await h.capture(); assert.equal(h.requests.length, 2); h.voice.close();
});

test('stale playback rejection is ignored; streamless incoming tracks still play', async () => {
  const h = harness(); await h.voice.start(); const play = deferred(); h.audios[0].play = () => play.promise;
  const track = new Track(); h.peers[0].ontrack({ streams: [], track });
  assert.equal(h.audios[0].srcObject.getTracks()[0], track);
  h.voice.close(); await h.voice.start(); play.reject(new Error('old playback failed')); await tick();
  assert.deepEqual(h.errors, []); h.voice.close();
});
