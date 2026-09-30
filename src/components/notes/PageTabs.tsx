import { FileText, Database, Folder, Plus, X } from 'lucide-react';
import type { NoteNode } from '../../lib/workspace';

export function PageTabs({ pages, active, select, close, create, move }: { pages: NoteNode[]; active: string; select: (id: string) => void; close: (id: string) => void; create: () => void; move: (id: string, before: string) => void }) {
  return <div className="notePageTabs" role="tablist" aria-label="Open pages">
    {pages.map(page => <div className="notePageTab" key={page.id} data-active={page.id === active} draggable onDragStart={event => event.dataTransfer.setData('application/localflow-tab', page.id)} onDragOver={event => { if (event.dataTransfer.types.includes('application/localflow-tab')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); move(event.dataTransfer.getData('application/localflow-tab'), page.id); }}>
      <button role="tab" aria-selected={page.id === active} title={page.label} onClick={() => select(page.id)} onAuxClick={event => { if (event.button === 1) close(page.id); }} onKeyDown={event => { if (event.key === 'Delete') close(page.id); if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const at = pages.findIndex(item => item.id === page.id); select(pages[(at + (event.key === 'ArrowRight' ? 1 : -1) + pages.length) % pages.length].id); } }}>{page.kind === 'database' ? <Database size={13} /> : page.kind === 'folder' ? <Folder size={13} /> : <FileText size={13} />}<span>{page.label}</span></button>
      <button className="closePageTab" aria-label={`Close ${page.label}`} onClick={() => close(page.id)}><X size={12} /></button>
    </div>)}
    <button className="newPageTab" aria-label="New page tab" title="New page tab" onClick={create}><Plus size={15} /></button>
  </div>;
}
