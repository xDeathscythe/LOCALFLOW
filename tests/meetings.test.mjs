import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMeetingService } from '../host/meetings/session.mjs';
import { createMeetingStore } from '../host/meetings/store.mjs';
import { createNotesService } from '../host/notes-service.mjs';
import { validateMeetingSummary } from '../host/meetings/summary.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate) { for (let attempt = 0; attempt < 160; attempt++) { const value = await read(); if (predicate(value)) return value; await delay(25); } throw new Error('Meeting fixture did not settle.'); }
function wav(path, seconds = 1) {
  const bytes = Buffer.alloc(44 + seconds * 32000); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); writeFileSync(path, bytes);
}
let actionText = 'Pripremiti predlog';
function summary(segments) {
  const point = { text: '日本語 العربية dogovor', evidence: [segments[0].id] };
  return { title: 'Dogovor o projektu', language: 'sr', labels: Object.fromEntries(['overview', 'keyPoints', 'topics', 'decisions', 'actions', 'openQuestions', 'nextSteps', 'transcript', 'microphone', 'remote', 'owner', 'dueDate'].map(key => [key, key])), overview: [point], topics: [{ title: 'Projektni dogovor', points: [point] }], keyPoints: [], decisions: [], actions: [{ text: actionText, evidence: point.evidence, owner: null, dueDate: null, ownerQuote: null, dueQuote: null }], openQuestions: [], nextSteps: [] };
}
const directory = mkdtempSync(join(tmpdir(), 'localflow-meetings-'));
const notes = createNotesService(directory, () => {}), nativeCalls = [], jobs = [], notifications = [];
let captured = null, failSummary = false, saveRace = false, summaryRuns = 0;
const canonicalSave = notes.save;
notes.save = async value => {
  if (saveRace) { saveRace = false; const previous = await notes.read(value.id); await canonicalSave({ ...previous, content: `${previous.content}\n\nRACE PRESERVED`, revision: previous.revision }); }
  return canonicalSave(value);
};
const native = async (method, params) => {
  assert.equal(method, 'meeting-call'); nativeCalls.push(params);
  if (params.action === 'probe') return { supported: true, devices: [], candidates: [], sessions: [] };
  if (params.action === 'start') { captured = { ...params, state: 'recording', chunks: [] }; return captured; }
  if (params.action === 'stop') { captured = { ...captured, state: 'stopped' }; return captured; }
  if (params.action === 'status') return captured || { state: 'idle' };
  if (params.action === 'pause') return { state: 'paused' };
  if (params.action === 'resume') return { state: 'recording' };
  if (params.action === 'mute') return { state: 'recording', muted: params.muted };
  throw new Error(`Unknown native fixture action ${params.action}`);
};
const transcription = { isBusy: () => false, cancel() {}, async send(action, params, id, options) {
  assert.equal(action, 'transcribe'); assert.equal(options.owner, 'meeting'); assert.equal(params.options.transcriptOnly, true); assert.equal(params.options.language, 'auto'); jobs.push(id);
  return { rawText: '日本語 العربية dogovor', language: 'sr', segments: [{ start: 0, end: 1, text: '日本語 العربية dogovor' }] };
} };
const options = { directory, notes, native, transcription, notify: value => notifications.push(value), summarize: async ({ segments }) => { summaryRuns++; if (failSummary) throw new Error('Offline fixture'); return validateMeetingSummary(summary(segments), segments); } };
let service;
try {
  service = await createMeetingService(options);
  assert.deepEqual(nativeCalls.map(value => value.action), ['status'], 'Startup may inspect the recorder but must not start audio capture.');
  service.nativeEvent({ type: 'candidate', callId: 'voice-message', capture: true, render: false, processId: 42 });
  assert.equal((await service.call('status')).offer, null, 'A voice message must not open an automatic offer.');
  service.nativeEvent({ type: 'candidate', callId: 'confirmed-call', capture: true, render: true, confirmedCall: true, processId: 42, application: 'Fixture call' });
  assert.equal((await service.call('status')).offer.callId, 'confirmed-call');
  await service.call('decline');
  service.nativeEvent({ type: 'candidate', callId: 'confirmed-call', confirmedCall: true, processId: 42 });
  assert.equal((await service.call('status')).offer, null);
  await service.call('offer', { processId: 42, title: 'Original meeting' });
  const [started, duplicated] = await Promise.all([service.call('accept'), service.call('accept')]);
  assert.equal(started.active.id, duplicated.active.id);
  assert.equal(nativeCalls.filter(value => value.action === 'start').length, 1);
  const id = started.active.id, noteId = started.active.noteId;
  const folderId = (await service.call('status')).settings.folderId;
  await notes.rename({ id: folderId, label: 'Sastanci العربية' });
  await service.call('pause'); assert.equal((await service.call('status')).active.state, 'paused');
  await service.call('resume'); await service.call('mute', { muted: true }); assert.equal((await service.call('status')).active.muted, true);
  const path = join(captured.directory, 'microphone-0-0-1000000.wav'); wav(path);
  const chunk = { type: 'chunk', sessionId: id, source: 'microphone', index: 0, path, startMs: 0, endMs: 1000 };
  captured.chunks.push(chunk); service.nativeEvent(chunk); service.nativeEvent(chunk);
  await until(() => service.call('status'), value => value.active.processedChunks === 1 && value.active.lastNoteAt);
  assert.equal(jobs.length, 1);
  const note = await notes.read(noteId);
  await canonicalSave({ ...note, label: 'My handwritten title', content: `${note.content}\n\nUSER PRESERVED`, document: { ...note.document, content: [...note.document.content, { type: 'paragraph', content: [{ type: 'text', text: 'USER PRESERVED', marks: [{ type: 'bold' }] }] }] }, revision: note.revision });
  saveRace = true;
  await service.call('stop');
  const finished = await until(() => service.call('status'), value => value.sessions[0].summaryState === 'ready');
  assert.equal(finished.active, null); assert.equal(finished.sessions[0].chunkCount, 1);
  const final = await notes.read(noteId);
  assert.equal((await service.call('read-note', { noteId })).summary.topics[0].title, 'Projektni dogovor');
  assert.equal((await service.call('read', { id })).transcript[0].text, '日本語 العربية dogovor');
  assert.equal(await service.call('read-note', { noteId: randomUUID() }), null);
  const checked = await service.call('action-check', { id, index: 0, text: 'Pripremiti predlog', checked: true });
  assert.deepEqual(checked.actionStatus, [true]);
  assert.match((await notes.read(noteId)).content, /\[x\]/);
  await assert.rejects(service.call('action-check', { id, index: 0, text: 'Different regenerated task', checked: false }), /action changed/);
  assert.equal(final.label, 'My handwritten title'); assert.match(final.content, /USER PRESERVED/); assert.match(final.content, /RACE PRESERVED/); assert.match(final.content, /日本語 العربية/);
  assert.match(final.content, /localflow-note:\/\//); assert(final.document.content.some(node => node.attrs?.blockId === 'meeting-segment-microphone-0-0'));
  await service.call('retry', { id }); await until(() => service.call('status'), value => value.sessions[0].summaryState === 'ready');
  assert.equal((await notes.read(noteId)).label, 'My handwritten title', 'Retries preserve a handwritten title.');
  assert.deepEqual((await service.call('read', { id })).actionStatus, [true], 'The same regenerated action keeps its completion.');
  actionText = 'Razmotriti drugi predlog';
  await service.call('retry', { id }); await until(() => service.call('status'), value => value.sessions[0].summaryState === 'ready');
  assert.deepEqual((await service.call('read', { id })).actionStatus, [false], 'A different regenerated action does not inherit completion.');
  const next = await service.call('start', { processId: 42 });
  assert.equal(next.settings.folderId, folderId, 'Renaming Meetings does not create a second folder.');
  await service.call('stop'); await service.close(); service = null;

  // Crash recovery includes a finalized WAV missed by the journal, a truncated journal line, and the last PCM16 partial.
  const store = createMeetingStore(directory), recoveredId = randomUUID();
  const recovered = { id: recoveredId, title: 'Recovered', state: 'recording', startedAt: Date.now(), elapsedMs: 0, chunks: [], summaryState: 'waiting', errors: [] };
  mkdirSync(store.audioDirectory(recoveredId), { recursive: true }); store.save(recovered);
  const recoveredAudio = store.audioDirectory(recoveredId), part = join(recoveredAudio, 'remote-1-1000000.wav.part');
  wav(join(recoveredAudio, 'microphone-0-0-1000000.wav')); wav(part);
  writeFileSync(`${part}.json`, JSON.stringify({ sessionId: recoveredId, source: 'remote', index: 1, startMs: 1000, channels: 1, sampleRate: 16000 }));
  writeFileSync(join(recoveredAudio, 'manifest.jsonl'), '{"type":"chunk"');
  failSummary = true;
  const beforeRecoveryJobs = jobs.length;
  service = await createMeetingService(options);
  const recoveredState = await until(() => service.call('status'), value => value.sessions.some(session => session.id === recoveredId && session.summaryError));
  assert.equal(recoveredState.active, null, 'Crash recovery must never restart recording.');
  assert.equal(recoveredState.sessions.find(session => session.id === recoveredId).processedChunks, 2);
  assert.equal(jobs.length - beforeRecoveryJobs, 2);
  assert.equal((await notes.list()).items.filter(item => item.kind === 'folder').length, 1);
  const recoveryNoteId = recoveredState.sessions.find(session => session.id === recoveredId).noteId;
  assert.match((await notes.read(recoveryNoteId)).content, /日本語 العربية/);
  failSummary = false; await service.call('retry', { id: recoveredId });
  await until(() => service.call('status'), value => value.sessions.find(session => session.id === recoveredId).summaryState === 'ready');
  assert.equal(jobs.length - beforeRecoveryJobs, 2, 'Summary retry does not repeat completed ASR chunks.');
  await service.close(); service = null;

  const validated = summary([{ id: 'a' }]); validated.actions = [{ text: 'Task', evidence: ['a'], owner: 'Someone', ownerQuote: 'invented owner', dueDate: null, dueQuote: null }];
  assert.throws(() => validateMeetingSummary(validated, [{ id: 'a', text: 'Only evidence' }]), /supporting quote/);
  validated.actions = []; validated.topics[0].points[0].evidence = ['missing'];
  assert.throws(() => validateMeetingSummary(validated, [{ id: 'a', text: 'Only evidence' }]), /missing transcript/);
  assert(existsSync(join(directory, 'meetings', recoveredId, 'summary.json')));
  assert(JSON.parse(readFileSync(join(directory, 'meetings', recoveredId, 'session.json'))).noteId === recoveryNoteId);
  console.log(`MEETINGS_OK: consent, voice-message suppression, one session/note, pause/mute, two-channel timeline, scoped ASR, Notes revisions and manual edits, crash WAV/partial recovery, offline summary retry, ${summaryRuns} isolated summary fixtures`);
} finally { await service?.close(); await notes.close(); }
