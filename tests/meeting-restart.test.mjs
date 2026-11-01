import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotesService } from '../host/notes-service.mjs';
import { createMeetingStore } from '../host/meetings/store.mjs';
import { createMeetingNotes } from '../host/meetings/notes.mjs';
import { createMeetingService } from '../host/meetings/session.mjs';

function wav(path) {
  const bytes = Buffer.alloc(32044); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(32000, 40);
  writeFileSync(path, bytes); return bytes;
}
async function until(read, predicate) {
  for (let attempt = 0; attempt < 160; attempt++) { const result = await read(); if (predicate(result)) return result; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Restart fixture did not settle.');
}
function persistedRecording() {
  const directory = mkdtempSync(join(tmpdir(), 'localflow-meeting-restart-')), store = createMeetingStore(directory), id = randomUUID();
  const session = { id, title: 'Existing meeting', state: 'recording', startedAt: Date.now() - 42_000, elapsedMs: 1000, muted: false, chunks: [], summaryState: 'waiting', errors: [] };
  mkdirSync(store.audioDirectory(id), { recursive: true }); store.save(session);
  const part = join(store.audioDirectory(id), 'microphone-1-1000000.wav.part'), bytes = wav(part);
  writeFileSync(`${part}.json`, JSON.stringify({ sessionId: id, source: 'microphone', index: 1, startMs: 1000, sampleRate: 16000, channels: 1 }));
  return { directory, store, session, part, bytes };
}

for (const state of ['recording', 'paused']) {
  const { directory, store, session, part, bytes } = persistedRecording(), notes = createNotesService(directory, () => {}), settings = {};
  const writer = createMeetingNotes({ notes, store, settings, persistSettings: () => store.saveSettings(settings) });
  const calls = [], jobs = [], sources = [{ source: 'microphone', available: true }, { source: 'remote', available: true }];
  let service, summaries = 0, capture = { sessionId: session.id, state, elapsedMs: 42_000, muted: true, sources };
  const chunks = ['microphone', 'remote'].map(source => {
    const path = join(store.audioDirectory(session.id), `${source}-0-0-1000000.wav`); wav(path);
    return { type: 'chunk', sessionId: session.id, source, index: 0, path, startMs: 0, endMs: 1000 };
  });
  store.addChunk(session, chunks[0]); session.chunks[0].status = 'processing'; store.save(session);
  const journal = join(store.audioDirectory(session.id), 'manifest.jsonl');
  writeFileSync(journal, chunks.map(chunk => JSON.stringify(chunk)).join('\n') + '\n');
  const native = async (method, value) => {
    assert.equal(method, 'meeting-call'); calls.push(value);
    if (value.action === 'status') return capture;
    assert.equal(value.action, 'stop', 'Restart must never start or resume audio.'); assert.equal(value.sessionId, session.id);
    assert.deepEqual(readFileSync(part), bytes, 'Host must not salvage or alter the native recorder’s open WAV.');
    const path = join(store.audioDirectory(session.id), 'microphone-1-1000000-2000000.wav'); renameSync(part, path); unlinkSync(`${part}.json`);
    chunks.push({ type: 'chunk', sessionId: session.id, source: 'microphone', index: 1, path, startMs: 1000, endMs: 2000 });
    appendFileSync(journal, JSON.stringify(chunks.at(-1)) + '\n');
    capture = { ...capture, state: 'stopped', chunks }; return capture;
  };
  try {
    await writer.sync(session, []); const noteId = session.noteId;
    service = await createMeetingService({ directory, notes, native,
      transcription: { isBusy: () => false, cancel() {}, async send(action, params, id) { jobs.push(id); return { rawText: 'Durable speech.', language: 'en', segments: [{ text: 'Durable speech.', start: 0, end: 1 }] }; } },
      summarize: async () => { summaries++; return { title: 'Recovered meeting', language: 'en', labels: {}, overview: [], topics: [], keyPoints: [], decisions: [], actions: [], openQuestions: [], nextSteps: [] }; },
    });
    const current = await until(() => service.call('status'), value => value.active?.processedChunks === 2);
    assert.deepEqual(calls.map(call => call.action), ['status']);
    assert.equal(current.active.id, session.id); assert.equal(current.active.noteId, noteId); assert.equal(current.active.state, state);
    assert.equal(current.active.elapsedMs, 42_000); assert.equal(current.active.muted, true); assert.deepEqual(current.active.sources, sources);
    assert.equal(current.active.interrupted, undefined); assert.equal(current.active.endedAt, undefined); assert.equal(summaries, 0, 'An attached active meeting must not be summarized.');
    assert.deepEqual(readFileSync(part), bytes); assert(existsSync(`${part}.json`)); assert.equal(jobs.length, 2, 'Pending work and a missed finalized journal chunk must both resume.');
    assert.equal((await service.call('start', { processId: 42 })).active.id, session.id, 'A new Start cannot replace the reattached recording.');
    assert.deepEqual(calls.map(call => call.action), ['status']);
    service.nativeEvent({ type: 'state', sessionId: session.id, status: { ...capture, elapsedMs: 43_000 } });
    assert.equal((await service.call('status')).active.elapsedMs, 43_000);
    await service.call('stop');
    const finished = await until(() => service.call('status'), value => value.sessions[0].summaryState === 'ready');
    assert.equal(finished.active, null); assert.equal(finished.sessions[0].processedChunks, 3); assert.equal(finished.sessions[0].noteId, noteId);
    assert.equal(summaries, 1); assert.equal(jobs.length, 3); assert.deepEqual(calls.map(call => call.action), ['status', 'stop']);
    assert.equal((await notes.list()).items[0].children.length, 1, 'Host restart preserves the original single meeting note.');
  } finally { await service?.close(); await notes.close(); }
}

// An unrelated native recorder must finish writing before any interrupted session’s partials are recovered.
{
  const { directory, store, session, part, bytes } = persistedRecording(), notes = createNotesService(directory, () => {}), orphanId = randomUUID(), calls = [];
  let service;
  try {
    service = await createMeetingService({ directory, notes,
      native: async (method, value) => {
        calls.push(value);
        if (value.action === 'status') return { sessionId: orphanId, state: 'recording' };
        assert.equal(value.action, 'stop'); assert.equal(value.sessionId, orphanId); assert.deepEqual(readFileSync(part), bytes);
        return { sessionId: orphanId, state: 'stopped', chunks: [] };
      }, transcription: { isBusy: () => true, cancel() {} },
    });
    const current = await service.call('status');
    assert.deepEqual(calls.map(call => call.action), ['status', 'stop']); assert.equal(current.active, null);
    assert(current.errors.some(error => error.sessionId === orphanId && /unrecognized recording/.test(error.message)));
    assert.equal(current.sessions[0].state, 'interrupted'); assert(!existsSync(part));
    assert(existsSync(join(store.audioDirectory(session.id), 'microphone-1-1000000-2000000.wav')));
  } finally { await service?.close(); await notes.close(); }
}

for (const failure of ['status', 'stop', 'unconfirmed-stop']) {
  const { directory, store, session, part, bytes } = persistedRecording(), calls = [];
  await assert.rejects(createMeetingService({ directory, notes: {}, transcription: {}, native: async (method, value) => {
    calls.push(value.action);
    if (failure === 'status') throw new Error('Native status unavailable.');
    if (value.action === 'status') return { sessionId: randomUUID(), state: 'recording' };
    if (failure === 'stop') throw new Error('Native Stop timed out.');
    return { state: 'recording' };
  } }), /unavailable|timed out|did not confirm stopping/);
  assert.deepEqual(calls, failure === 'status' ? ['status'] : ['status', 'stop']);
  assert.deepEqual(readFileSync(part), bytes); assert(existsSync(`${part}.json`));
  assert.equal(JSON.parse(readFileSync(join(store.folder(session.id), 'session.json'), 'utf8')).state, 'recording', 'Unverified native state must not be reported as recovered or finished.');
}
console.log('MEETING_HOST_RESTART_OK: live recording/paused reattachment, untouched native partials, journal replay, original Stop/note, orphan stop before recovery, fail-closed status/stop');
