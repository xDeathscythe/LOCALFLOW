import { realpathSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJsonFile, writeJsonFile } from './niwa/host/niwa-store.mjs';

export function createProjectStore(directory) {
  const index = join(directory, 'projects.json');
  const state = readJsonFile(index, { folders: [], chats: [], activeId: 'niwa' });
  const commit = () => writeJsonFile(index, state);
  if (state.folders.some(item => item.parentId)) {
    const roots = new Map(state.folders.map(item => {
      let root = item; const seen = new Set([item.id]);
      while (root.parentId) {
        root = state.folders.find(candidate => candidate.id === root.parentId);
        if (!root || seen.has(root.id)) throw new Error('Invalid project hierarchy.');
        seen.add(root.id);
      }
      return [item.id, root.id];
    }));
    if (!existsSync(index + '.before-flat')) copyFileSync(index, index + '.before-flat');
    for (const item of state.chats) item.folderId = roots.get(item.folderId) || item.folderId;
    state.folders = state.folders.filter(item => !item.parentId);
    for (const item of state.folders) delete item.parentId;
    commit();
  }
  const folder = id => { const value = state.folders.find(item => item.id === id); if (!value) throw new Error('Workspace folder not found.'); return value; };
  const chat = id => { const value = state.chats.find(item => item.id === id); if (!value) throw new Error('Chat not found.'); return value; };
  const file = id => id === 'niwa' ? join(directory, 'conversation.json') : (chat(id), join(directory, 'chats', `${id}.json`));
  return {
    snapshot: () => structuredClone(state), folder, chat, file,
    addFolder({ path, parentId }) {
      if (parentId) throw new Error('Projects contain chats, not subfolders.');
      const cwd = realpathSync(path);
      if (!statSync(cwd).isDirectory()) throw new Error('Choose a directory.');
      const existing = state.folders.find(item => item.cwd === cwd);
      if (existing) return existing;
      const item = { id: randomUUID(), cwd, label: basename(cwd) || cwd };
      state.folders.push(item); commit(); return item;
    },
    createChat(folderId) {
      if (folder(folderId).archived) throw new Error('Restore the project before adding a chat.');
      const item = { id: randomUUID(), folderId, label: 'New chat', autoTitle: true, updatedAt: Date.now() };
      state.chats.push(item); commit(); return item;
    },
    select(id) { if (id !== 'niwa' && (chat(id).archived || folder(chat(id).folderId).archived)) throw new Error('Restore the chat or project first.'); state.activeId = id; commit(); },
    manage({ kind, id, action }) {
      if (!['project', 'chat'].includes(kind) || !['archive', 'restore', 'delete'].includes(action)) throw new Error('Invalid project action.');
      const item = kind === 'project' ? folder(id) : chat(id);
      if (action === 'delete') {
        // Conversation files remain recoverable, as with deleted notes.
        writeJsonFile(join(directory, 'removed-projects', `${id}.json`), { kind, item, chats: kind === 'project' ? state.chats.filter(chat => chat.folderId === id) : [] });
        if (kind === 'project') state.folders = state.folders.filter(folder => folder.id !== id);
        state.chats = state.chats.filter(chat => kind === 'project' ? chat.folderId !== id : chat.id !== id);
      } else item.archived = action === 'archive';
      if (state.activeId !== 'niwa' && (!state.chats.some(chat => chat.id === state.activeId) || chat(state.activeId).archived || folder(chat(state.activeId).folderId).archived)) state.activeId = 'niwa';
      commit();
    },
    rename({ id, label }) { if (typeof label !== 'string' || !label.trim() || label.length > 300) throw new Error('Enter a chat title.'); chat(id).label = label.trim(); chat(id).autoTitle = false; commit(); },
    touch(id, firstMessage) {
      if (id === 'niwa') return;
      const item = chat(id); item.updatedAt = Date.now();
      if (item.autoTitle && firstMessage) { item.label = Array.from(firstMessage.replace(/\s+/g, ' ').trim()).slice(0, 60).join(''); item.autoTitle = false; }
      commit();
    },
  };
}
