import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStore } from '../electron/project-store.mjs';
const directory = mkdtempSync(join(tmpdir(), 'localflow-projects-'));
mkdirSync(join(directory, 'workspace', 'child'), { recursive: true });
writeFileSync(join(directory, 'projects.json'), JSON.stringify({ folders: [
  { id: 'root', cwd: join(directory, 'workspace'), label: '日本語', parentId: null },
  { id: 'child', cwd: join(directory, 'workspace', 'child'), label: '子', parentId: 'root' },
], chats: [{ id: 'chat', folderId: 'child', label: 'العربية' }], activeId: 'chat' }));
mkdirSync(join(directory, 'chats'));
writeFileSync(join(directory, 'chats', 'chat.json'), '{"transcript":["untouched"]}');
let store = createProjectStore(directory);
assert.equal(store.snapshot().folders.length, 1);
assert.equal(store.chat('chat').folderId, 'root');
assert(existsSync(join(directory, 'projects.json.before-flat')));
assert.throws(() => store.addFolder({ path: directory, parentId: 'root' }), /subfolders/);
store.manage({ kind: 'project', id: 'root', action: 'archive' });
assert.equal(store.snapshot().activeId, 'niwa');
assert.throws(() => store.createChat('root'), /Restore/);
store = createProjectStore(directory);
assert.equal(store.folder('root').archived, true);
store.manage({ kind: 'project', id: 'root', action: 'restore' }); store.select('chat');
store.manage({ kind: 'chat', id: 'chat', action: 'archive' });
assert.throws(() => store.select('chat'), /Restore/);
store.manage({ kind: 'chat', id: 'chat', action: 'restore' }); store.select('chat');
store.manage({ kind: 'chat', id: 'chat', action: 'delete' });
assert.equal(store.snapshot().chats.length, 0);
assert.equal(readFileSync(join(directory, 'chats', 'chat.json'), 'utf8'), '{"transcript":["untouched"]}');
store.createChat('root'); store.manage({ kind: 'project', id: 'root', action: 'delete' });
assert.equal(store.snapshot().folders.length, 0); assert.equal(store.snapshot().chats.length, 0);
assert(existsSync(join(directory, 'workspace', 'child')));
assert.throws(() => store.manage({ kind: 'chat', id: 'niwa', action: 'delete' }), /not found/);
console.log('PROJECT_LIFECYCLE_OK: flatten migration, backup, archive/restore/delete, restart, workspace and transcript preservation');
