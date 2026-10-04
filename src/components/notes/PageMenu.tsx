import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, FilePlus2, FolderPlus, Database, ArrowRight, Pencil, Trash2, PanelTop, Link, Search, History, Monitor, Paintbrush, Sparkles, Upload, BookOpen, Check } from 'lucide-react';
import type { NoteNode, PagePresentation } from '../../lib/workspace';

export type PageAppearance = Pick<PagePresentation, 'font' | 'small' | 'wide' | 'locked' | 'wiki'>;
export type PageAction = 'tab' | 'rename' | 'move' | 'duplicate' | 'delete' | 'note' | 'folder' | 'database' | 'markdown' | 'pdf' | 'copy' | 'link' | 'present' | 'customize' | 'history' | 'trash' | 'ai' | 'suggest' | 'translate' | 'import' | 'notion' | 'info';
export function PageMenu({ node, x, y, close, action, appearance, changeAppearance, words }: { node: NoteNode; x: number; y: number; close: () => void; action: (action: PageAction) => void; appearance: PageAppearance; changeAppearance: (patch: PageAppearance) => void; words?: number }) {
  const ref = useRef<HTMLDivElement>(null), [search, setSearch] = useState('');
  useEffect(() => {
    const pointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      if (!buttons.length) return;
      event.preventDefault(); const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    };
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [close]);
  const command = (id: PageAction) => { close(); action(id); };
  const matches = (text: string) => text.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const entry = (id: PageAction, title: string, Icon: typeof Copy, shortcut?: string) => matches(title) && <button key={id} aria-label={title} role="menuitem" className={id === 'delete' ? 'danger' : undefined} onClick={() => command(id)}><Icon size={15}/><span>{title}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
  const toggle = (key: 'small' | 'wide' | 'locked' | 'wiki', title: string) => matches(title) && <button role="menuitemcheckbox" aria-checked={Boolean(appearance[key])} disabled={Boolean(appearance.locked && key !== 'locked')} onClick={() => changeAppearance({ [key]: !appearance[key] })}><span>{title}</span><span className="noteMenuSwitch" data-on={Boolean(appearance[key])}/></button>;
  return createPortal(<div ref={ref} role="menu" aria-label="Page actions" tabIndex={-1} className="notesPageMenu" style={{ left: Math.max(8, Math.min(x, innerWidth - 290)), top: Math.max(8, Math.min(y, innerHeight - 620)), maxHeight: 'min(620px, calc(100vh - 16px))' }}>
    <label className="noteActionSearch"><Search size={14}/><input autoFocus aria-label="Search page actions" placeholder="Search actions…" value={search} onChange={event => setSearch(event.target.value)}/></label>
    {node.kind === 'note' && <>
      {!search && <div className="noteFontOptions">{(['default','serif','mono'] as const).map(font => <button key={font} disabled={appearance.locked} role="menuitemradio" aria-checked={(appearance.font || 'default') === font} style={{ fontFamily: font === 'serif' ? 'Georgia, serif' : font === 'mono' ? 'monospace' : undefined }} onClick={() => changeAppearance({ font })}>Ag<small>{font}</small></button>)}</div>}
      {entry('link','Copy link',Link,'Ctrl+L')}{entry('copy','Copy page contents',Copy)}
    </>}
    {entry('tab','Open in new tab',PanelTop)}{entry('rename','Rename',Pencil)}{entry('duplicate','Duplicate',Copy,'Ctrl+D')}{entry('move','Move to…',ArrowRight,'Ctrl+Shift+P')}{entry('delete','Move to Trash',Trash2)}
    <hr/>
    {node.kind === 'note' && <>
      {entry('present','Present',Monitor,'Ctrl+Alt+P')}
      {!search && <div className="noteOfflineStatus"><Check size={14}/>Available offline<span>Always</span></div>}
      {toggle('small','Small text')}{toggle('wide','Full width')}{entry('customize','Customize page',Paintbrush)}{toggle('locked','Lock page')}
      <hr/>{entry('ai','Use with AI',Sparkles)}{entry('suggest','Suggest edits',Pencil)}{entry('translate','Translate',BookOpen)}<hr/>
      {entry('import','Import Markdown / text',Upload)}{entry('notion','Import Notion',Upload)}
      {entry('pdf','Export PDF',Download)}{entry('markdown','Export Markdown',Download)}
      <hr/>{toggle('wiki','Turn into wiki')}{entry('history','Version history',History)}{entry('info','Page information',BookOpen)}
    </>}
    {entry('note','Add page inside',FilePlus2)}{node.kind !== 'database' && <>{entry('folder','Add folder inside',FolderPlus)}{entry('database','Add database inside',Database)}</>}
    <hr/>{entry('trash','Trash',Trash2)}
    {!search && <footer className="noteMenuMetadata">{words !== undefined && <span>{words.toLocaleString()} words</span>}{node.updatedAt && <span>Last edited {new Date(node.updatedAt).toLocaleString()}</span>}<span>Stored on this computer</span></footer>}
  </div>, document.body);
}
