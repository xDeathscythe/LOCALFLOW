import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Asterisk, Folder, FolderPlus, MessageSquare, Plus, Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import type { Projects } from '../lib/workspace';
import { DatabaseMenu } from './notes/DatabaseMenu';

type Item = { kind: 'project' | 'chat'; id: string; label: string; archived?: boolean };
export function ProjectSidebar({ target, projects, disabled, run }: { target: HTMLElement; projects: Projects; disabled: boolean; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [renaming, setRenaming] = useState('');
  const [title, setTitle] = useState('');
  const [archived, setArchived] = useState(false);
  const [menu, setMenu] = useState<{ item: Item; x: number; y: number } | null>(null);
  const current = projects.chats.find(chat => chat.id === projects.activeId);
  const add = () => run(async () => { const folder = await window.localflow.niwaAddProject(); if (folder) await window.localflow.niwaOpenFolder(folder.id); });
  const manage = (item: Item, action: 'archive' | 'restore' | 'delete') => { setMenu(null); void run(() => window.localflow.niwaManageProject({ kind: item.kind, id: item.id, action })); };
  const context = (event: React.MouseEvent, item: Item) => { event.preventDefault(); if (!disabled) setMenu({ item, x: event.clientX, y: event.clientY }); };
  const actions = (item: Item) => <span className="projectRowActions">
    {item.kind === 'project' && !item.archived && <button disabled={disabled} aria-label={`New chat in ${item.label}`} title="New chat" onClick={event => { event.preventDefault(); void run(() => window.localflow.niwaNewChat(item.id)); }}><Plus size={13} /></button>}
    <button disabled={disabled} aria-label={`${item.archived ? 'Restore' : 'Archive'} ${item.label}`} title={item.archived ? 'Restore' : 'Archive'} onClick={event => { event.preventDefault(); manage(item, item.archived ? 'restore' : 'archive'); }}>{item.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}</button>
    <button disabled={disabled} aria-label={`Delete ${item.label}`} title={item.kind === 'project' ? 'Remove project and chats from LocalFlow' : 'Delete chat'} onClick={event => { event.preventDefault(); manage(item, 'delete'); }}><Trash2 size={13} /></button>
  </span>;
  const folders = projects.folders.filter(folder => archived ? folder.archived || projects.chats.some(chat => chat.folderId === folder.id && chat.archived) : !folder.archived);
  return createPortal(<aside className="projectsTreePane" aria-label="Agent projects">
    <button className={`niwaHome ${projects.activeId === 'niwa' ? 'selected' : ''}`} disabled={disabled} onClick={() => void run(() => window.localflow.niwaSelectChat('niwa'))}><Asterisk size={17} /> Niwa</button>
    <div className="notesTreeToolbar"><strong>{archived ? 'Archive' : 'Projects'}</strong><span className="projectToolbarActions"><button aria-label="Show archived projects and chats" title={archived ? 'Back to projects' : 'Archive'} aria-pressed={archived} onClick={() => setArchived(!archived)}><Archive size={14} /></button><button disabled={disabled} onClick={() => void add()} title="Add project" aria-label="Add project"><FolderPlus size={16} /></button></span></div>
    <div className="projectTree">{folders.map(folder => <details className="projectFolder" open key={folder.id}>
      <summary className={current?.folderId === folder.id ? 'selected' : ''} onContextMenu={event => context(event, { ...folder, kind: 'project' })}><Folder size={14} /><button disabled={disabled || folder.archived} title={folder.cwd} onClick={event => { event.preventDefault(); void run(() => window.localflow.niwaOpenFolder(folder.id)); }}>{folder.label}</button>{actions({ ...folder, kind: 'project' })}</summary>
      <div className="projectChildren">{projects.chats.filter(chat => chat.folderId === folder.id && (archived ? folder.archived || chat.archived : !chat.archived)).map(chat => <div className={`projectChat ${projects.activeId === chat.id ? 'selected' : ''}`} key={chat.id} onContextMenu={event => context(event, { ...chat, kind: 'chat' })}>
        {renaming === chat.id ? <form onSubmit={event => { event.preventDefault(); void run(async () => { await window.localflow.niwaRenameChat({ id: chat.id, label: title }); setRenaming(''); }); }}><input autoFocus aria-label="Chat title" value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setRenaming(''); }} /><button type="submit">✓</button></form> : <><button disabled={disabled || chat.archived || folder.archived} onDoubleClick={() => { setRenaming(chat.id); setTitle(chat.label); }} onClick={() => void run(() => window.localflow.niwaSelectChat(chat.id))}><MessageSquare size={12} /><span>{chat.label}</span></button>{actions({ ...chat, kind: 'chat' })}</>}
      </div>)}</div>
    </details>)}</div>
    {!folders.length && !archived && <button className="addFirstProject" disabled={disabled} onClick={() => void add()}><Plus size={15} /> Add project</button>}
    {archived && !folders.length && <span className="projectArchiveEmpty">No archived projects or chats</span>}
    {menu && <DatabaseMenu className="projectContextMenu" x={menu.x} y={menu.y} close={() => setMenu(null)}>
      {menu.item.kind === 'chat' && <button role="menuitem" onClick={() => { setRenaming(menu.item.id); setTitle(menu.item.label); setMenu(null); }}><Pencil size={14} />Rename</button>}
      <button role="menuitem" onClick={() => manage(menu.item, menu.item.archived ? 'restore' : 'archive')}><Archive size={14} />{menu.item.archived ? 'Restore' : 'Archive'}</button>
      <button role="menuitem" onClick={() => manage(menu.item, 'delete')}><Trash2 size={14} />Delete</button>
    </DatabaseMenu>}
  </aside>, target);
}
