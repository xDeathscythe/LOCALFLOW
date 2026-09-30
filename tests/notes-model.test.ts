import assert from 'node:assert/strict';
import { NOTES_STORAGE_KEY, LEGACY_NOTES_STORAGE_KEY, loadNotes, createInitialNotes } from '../src/lib/notes.ts';
const tree = [{ id: 'inbox', kind: 'folder', label: 'Inbox', children: [{ id: 'note', kind: 'note', label: '日本語', content: '# Извештај\n\nالعربية', updatedAt: '2026-09-30' }] }];
assert.deepEqual(loadNotes({ getItem: key => key === NOTES_STORAGE_KEY ? JSON.stringify(tree) : null }), tree);
assert.deepEqual(loadNotes({ getItem: () => null }), createInitialNotes());
const legacy = loadNotes({ getItem: key => key === NOTES_STORAGE_KEY ? 'corrupt' : key === LEGACY_NOTES_STORAGE_KEY ? 'Old note' : null });
assert.equal(legacy[0].kind === 'folder' && legacy[0].children[0].kind === 'note' && legacy[0].children[0].content, 'Old note');
console.log('NOTES_MIGRATION_INPUT_OK');
