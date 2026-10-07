import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import runtime from '../host/runtime-config.cjs';
import { summarizeMeeting } from '../host/meetings/summary.mjs';
import { createMeetingStore } from '../host/meetings/store.mjs';
import { createMeetingNotes } from '../host/meetings/notes.mjs';
import { createNotesService } from '../host/notes-service.mjs';

// Explicit opt-in smoke check: synthetic speech only; canonical auth is neither copied nor edited.
if (!process.argv.includes('--run')) throw new Error('Use --run for the synthetic provider check.');
const directory = process.env.LOCALFLOW_USER_DATA || join(process.env.APPDATA, 'localflow');
if (!existsSync(join(directory, 'niwa', 'codex', 'auth.json'))) throw new Error('The LocalFlow profile has no Codex file login; no provider request was made.');
const saved = existsSync(join(directory, 'niwa', 'settings.json')) ? JSON.parse(readFileSync(join(directory, 'niwa', 'settings.json'), 'utf8')) : {};
const session = { id: randomUUID(), title: 'Synthetic meeting validation', startedAt: Date.now(), elapsedMs: 8000, chunks: [], state: 'completed', errors: [], summaryState: 'ready' };
const segments = [
  { id: 'microphone-0-0', source: 'microphone', startMs: 0, endMs: 4000, text: 'Ana will send the revised proposal by Friday.', language: 'en' },
  { id: 'remote-0-0', source: 'remote', startMs: 4000, endMs: 8000, text: 'We agreed to review the revised proposal on Monday. The budget still needs approval.', language: 'en' },
];
const summary = await summarizeMeeting({ directory, binary: runtime.resolveNiwaCodexBinary, settings: { model: saved.model, effort: saved.effort }, session, segments, summaryLanguage: 'en' });
assert(summary.actions.some(action => action.owner === 'Ana' && action.dueDate === 'Friday' && action.evidence.includes('microphone-0-0')));
assert(summary.decisions.some(point => point.evidence.includes('remote-0-0')));
assert(summary.topics.length && summary.topics.every(topic => topic.title && topic.points.length));
const scratch = mkdtempSync(join(tmpdir(), 'localflow-summary-document-')), notes = createNotesService(scratch, () => {}), store = createMeetingStore(scratch);
const settings = {};
try {
  store.save(session);
  const writer = createMeetingNotes({ notes, store, settings, persistSettings: () => store.saveSettings(settings) });
  await writer.sync(session, segments, summary);
  const note = await notes.read(session.noteId);
  assert.equal(note.label, summary.title); assert(note.document.content.some(node => node.type === 'taskList'));
  assert(note.document.content.some(node => node.attrs?.blockId === 'meeting-segment-microphone-0-0'));
  assert.match(note.content, /Ana/); assert.match(note.content, /Friday/);
  console.log('MEETING_PROVIDER_SUMMARY_OK', JSON.stringify({ title: summary.title, topicCount: summary.topics.length, actionOwner: 'Ana', actionDueDate: 'Friday', evidence: 'microphone-0-0', noteHasTaskList: true, isolatedScratchNotes: true }));
} finally { await notes.close(); }
