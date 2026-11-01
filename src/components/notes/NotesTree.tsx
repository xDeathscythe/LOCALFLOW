import { useState } from 'react';
import { ChevronRight, Database, FileText, Folder, MoreHorizontal, Plus } from 'lucide-react';
import type { NoteNode } from '../../lib/workspace';

export function NotesTree({ items, selected, searching, open, menu, create, move }: { items: NoteNode[]; selected: string; searching: boolean; open: (id: string, newTab?: boolean) => void; menu: (id: string, x: number, y: number) => void; create: (id: string) => void; move: (id: string, parentId?: string, beforeId?: string) => void }) {
  const [expanded, setExpanded] = useState(new Set(items.filter(item => item.children?.length).map(item => item.id)));
  const [mounted, setMounted] = useState(expanded);
  const [drop, setDrop] = useState('');
  const toggle = (id: string) => {
    setMounted(before => new Set(before).add(id));
    setExpanded(before => { const after = new Set(before); if (after.has(id)) after.delete(id); else after.add(id); return after; });
  };
  const activate = (item: NoteNode, newTab = false) => { if (item.kind === 'folder' && !newTab) toggle(item.id); open(item.id, newTab); };
  const row = (item: NoteNode, level: number, parentId?: string) => <div key={item.id} role="none">
    <div className="notesPageTreeRow" role="treeitem" tabIndex={0} aria-level={level + 1} aria-selected={selected === item.id} aria-expanded={item.children?.length ? searching || expanded.has(item.id) : undefined} data-drop={drop.startsWith(`${item.id}:`) ? drop.split(':').at(-1) : undefined} style={{ paddingLeft: 8 + level * 14 }} draggable
      onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/localflow-page', item.id); }}
      onDragOver={event => { if (!event.dataTransfer.types.includes('application/localflow-page')) return; event.preventDefault(); event.stopPropagation(); setDrop(`${item.id}:${event.clientY - event.currentTarget.getBoundingClientRect().top < 8 ? 'before' : 'inside'}`); }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); const id = event.dataTransfer.getData('application/localflow-page'); if (id && id !== item.id) move(id, drop.endsWith(':before') ? parentId : item.id, drop.endsWith(':before') ? item.id : undefined); setDrop(''); }} onDragEnd={() => setDrop('')}
      onClick={event => activate(item, event.ctrlKey || event.metaKey)} onAuxClick={event => { if (event.button === 1) open(item.id, true); }} onContextMenu={event => { event.preventDefault(); menu(item.id, event.clientX, event.clientY); }} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(item, event.ctrlKey || event.metaKey); } if (event.key === 'ArrowRight' && !expanded.has(item.id)) toggle(item.id); if (event.key === 'ArrowLeft' && expanded.has(item.id)) toggle(item.id); if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); menu(item.id, rect.right, rect.top); } }}>
      <button className="notesTreeExpand" aria-label={`Expand ${item.label}`} onClick={event => { event.stopPropagation(); toggle(item.id); }} style={{ visibility: item.children?.length ? undefined : 'hidden' }}><ChevronRight size={12} style={{ transform: searching || expanded.has(item.id) ? 'rotate(90deg)' : undefined }} /></button>
      {item.kind === 'database' ? <Database size={14} /> : item.kind === 'folder' ? <Folder size={14} /> : <FileText size={14} />}<span>{item.label}</span>
      <button className="notesTreeReveal" aria-label={`Actions for ${item.label}`} onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); menu(item.id, rect.right, rect.bottom); }}><MoreHorizontal size={14} /></button>
      <button className="notesTreeReveal" aria-label={`Add inside ${item.label}`} onClick={event => { event.stopPropagation(); setExpanded(before => new Set([...before, item.id])); create(item.id); }}><Plus size={14} /></button>
    </div>
    {(searching || expanded.has(item.id) || mounted.has(item.id)) && item.children?.length ? <div className="notesTreeChildren" role="group" data-open={searching || expanded.has(item.id)} inert={!searching && !expanded.has(item.id)}
      onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'height' && !searching && !expanded.has(item.id)) setMounted(before => { const after = new Set(before); after.delete(item.id); return after; }); }}>{item.children.map(child => row(child, level + 1, item.id))}</div> : null}
  </div>;
  return <div className="notesTreeView notesPageTree" role="tree" aria-label="Pages" onDragOver={event => { if (event.target === event.currentTarget && event.dataTransfer.types.includes('application/localflow-page')) event.preventDefault(); }} onDrop={event => { if (event.target === event.currentTarget) { const id = event.dataTransfer.getData('application/localflow-page'); if (id) move(id); setDrop(''); } }}>{items.map(item => row(item, 0))}</div>;
}
