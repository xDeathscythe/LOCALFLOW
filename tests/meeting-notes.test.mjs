import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNotesService } from '../host/notes-service.mjs';
import { createMeetingStore } from '../host/meetings/store.mjs';
import { createMeetingNotes } from '../host/meetings/notes.mjs';

const directory = mkdtempSync(join(tmpdir(), 'localflow-meeting-notes-'));
const notes = createNotesService(directory, () => {}), store = createMeetingStore(directory), settings = {};
const session = { id: randomUUID(), title: 'Meeting', startedAt: Date.now(), elapsedMs: 1000, chunks: [], state: 'recording', summaryState: 'waiting', errors: [] };
const transcript = [{ id: 'microphone-0-0', source: 'microphone', startMs: 0, endMs: 1000, text: 'Original captured evidence.', language: 'en' }];
store.save(session);
const writer = createMeetingNotes({ notes, store, settings, persistSettings: () => store.saveSettings(settings) });
const text = node => [node.text || '', ...(node.content || []).map(text)].join(' ');
try {
  await writer.sync(session, transcript);
  let note = await notes.read(session.noteId);
  const edited = structuredClone(note.document);
  const paragraph = edited.content.find(node => text(node).includes('Original captured evidence.'));
  paragraph.content = [{ type: 'text', text: 'My edited evidence copy.', marks: [{ type: 'bold' }] }];
  await notes.save({ ...note, content: note.content.replace(/Original captured evidence\\?\./, 'My edited evidence copy.'), document: edited });
  await writer.sync(session, transcript);
  note = await notes.read(session.noteId);
  const count = note.document.content.length;
  for (let checkpoint = 0; checkpoint < 4; checkpoint++) { session.elapsedMs += 1000; await writer.sync(session, transcript); }
  note = await notes.read(session.noteId);
  assert.equal(note.document.content.length, count, 'Repeated checkpoints replace one generated suffix, not append duplicates.');
  assert.match(note.content, /My edited evidence copy/);
  assert.equal(note.document.content.filter(node => text(node).includes('My edited evidence copy.')).length, 1);
  assert.equal(note.document.content.filter(node => node.attrs?.blockId === 'meeting-segment-microphone-0-0').length, 1, 'Evidence has one unambiguous anchor.');
  assert(note.document.content.find(node => text(node).includes('My edited evidence copy.')).content[0].marks.some(mark => mark.type === 'bold'));

  // Simulate a crash after canonical Notes save, before the generated snapshot is committed.
  let crash = true;
  const crashingStore = { ...store, saveGenerated(id, value) { if (crash) throw new Error('Fixture crash after Notes save'); return store.saveGenerated(id, value); } };
  const retryWriter = createMeetingNotes({ notes, store: crashingStore, settings, persistSettings: () => store.saveSettings(settings) });
  const fresh = { ...session, id: randomUUID(), noteId: undefined, noteCreate: undefined, generatedTitle: undefined, noteRevision: undefined, titleEdited: undefined };
  store.save(fresh);
  await assert.rejects(retryWriter.sync(fresh, transcript), /Fixture crash/);
  const crashNote = await notes.read(fresh.noteId), crashCount = crashNote.document.content.length;
  crash = false;
  await retryWriter.sync(fresh, transcript);
  assert.equal((await notes.read(fresh.noteId)).document.content.length, crashCount, 'Crash replay recognizes the already saved generated document.');
  console.log('MEETING_NOTES_EDIT_GUARDS_OK: rich manual edits preserved, one generated suffix across checkpoints, unique evidence anchors, exact crash replay');
} finally { await notes.close(); }
