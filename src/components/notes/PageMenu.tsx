import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, FilePlus2, FolderPlus, Database, ArrowRight, Pencil, Trash2, PanelTop, Check } from 'lucide-react';
import type { NoteNode } from '../../lib/workspace';

export type PageAppearance = { font?: 'default' | 'serif' | 'mono'; small?: boolean; wide?: boolean };
export type PageAction = 'tab' | 'rename' | 'move' | 'duplicate' | 'delete' | 'note' | 'folder' | 'database' | 'markdown' | 'pdf' | 'copy';
export function PageMenu({ node, x, y, close, action, appearance, changeAppearance }: { node: NoteNode; x: number; y: number; close: () => void; action: (action: PageAction) => void; appearance: PageAppearance; changeAppearance: (patch: PageAppearance) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key); ref.current?.focus();
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [close]);
  const command = (id: PageAction) => { close(); action(id); };
  return createPortal(<div ref={ref} role="menu" aria-label="Page actions" tabIndex={-1} className="notesPageMenu" style={{ left: Math.max(8, Math.min(x, innerWidth - 260)), top: Math.max(8, Math.min(y, innerHeight - 540)) }}>
    {node.kind === 'note' && <><div className="noteFontOptions">{(['default','serif','mono'] as const).map(font => <button key={font} role="menuitemradio" aria-checked={(appearance.font || 'default') === font} style={{ fontFamily: font === 'serif' ? 'Georgia, serif' : font === 'mono' ? 'monospace' : undefined }} onClick={() => changeAppearance({ font })}>Ag<small>{font}</small></button>)}</div><button role="menuitemcheckbox" aria-checked={Boolean(appearance.small)} onClick={() => changeAppearance({ small: !appearance.small })}>Small text{appearance.small && <Check size={14} />}</button><button role="menuitemcheckbox" aria-checked={Boolean(appearance.wide)} onClick={() => changeAppearance({ wide: !appearance.wide })}>Full width{appearance.wide && <Check size={14} />}</button><hr /></>}
    <button role="menuitem" onClick={() => command('tab')}><PanelTop size={14} />Open in new tab</button>
    <button role="menuitem" onClick={() => command('rename')}><Pencil size={14} />Rename</button>
    <button role="menuitem" onClick={() => command('move')}><ArrowRight size={14} />Move to…</button>
    <button role="menuitem" onClick={() => command('duplicate')}><Copy size={14} />Duplicate</button>
    <details><summary>Add inside</summary><button role="menuitem" onClick={() => command('note')}><FilePlus2 size={14} />Page</button>{node.kind !== 'database' && <><button role="menuitem" onClick={() => command('folder')}><FolderPlus size={14} />Folder</button><button role="menuitem" onClick={() => command('database')}><Database size={14} />Database</button></>}</details>
    {node.kind === 'note' && <details><summary>Export</summary><button role="menuitem" onClick={() => command('pdf')}><Download size={14} />Export PDF</button><button role="menuitem" onClick={() => command('markdown')}><Download size={14} />Export Markdown</button><button role="menuitem" onClick={() => command('copy')}><Copy size={14} />Copy Markdown</button></details>}
    <hr /><button role="menuitem" className="danger" onClick={() => command('delete')}><Trash2 size={14} />Delete</button>
  </div>, document.body);
}
