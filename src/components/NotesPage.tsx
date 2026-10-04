import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FilePlus2, Folder, FolderPlus, Mic, Square, X, Database, ArrowLeft, MoreHorizontal, Upload, Plus } from 'lucide-react';
import { RowProperties } from './notes/RowProperties';
import { PageDesign } from './notes/PageDesign';
import { PageTabs } from './notes/PageTabs';
import { NotesTree } from './notes/NotesTree';
import { WikiContents } from './notes/WikiContents';
import { PageTools, type PageTool } from './notes/PageTools';
import { PageMenu, type PageAction, type PageAppearance } from './notes/PageMenu';
import { loadNotes, loadPageSession, savePageSession } from '../lib/notes';
import { assetUrl } from '../lib/asset-url';
import type { NoteNode, MarkdownNote } from '../lib/workspace';
import '../styles/note-pages.css';
import '../styles/note-layout.css';
const DatabasePage = lazy(() => import('./notes/DatabasePage').then(module => ({ default: module.DatabasePage })));
const NoteEditor = lazy(() => import('./NoteEditor').then(module => ({ default: module.NoteEditor })));

type Props = { sidebar: HTMLElement | null; header: HTMLElement | null; visible: boolean; onOpen: () => void; capture: { id: number; text: string } | null; onCaptureHandled: () => void; onStatus: (message: string) => void; recording: boolean; recordDisabled: boolean; onToggleRecording: () => void };
const find = (items: NoteNode[], id: string): NoteNode | undefined => items.reduce<NoteNode | undefined>((found, item) => found || (item.id === id ? item : find(item.children || [], id)), undefined);
const firstNote = (items: NoteNode[]): string | undefined => items.reduce<string | undefined>((found, item) => found || (item.kind === 'note' ? item.id : firstNote(item.children || [])), undefined);
const parentOf = (items: NoteNode[], id: string): string | undefined => items.reduce<string | undefined>((found, item) => found || (item.children?.some(child => child.id === id) ? item.id : parentOf(item.children || [], id)), undefined);
const allNodes = (values: NoteNode[]): NoteNode[] => values.flatMap(value => [value, ...allNodes(value.children || [])]);

export function NotesPage({ sidebar, header, visible, onOpen, capture, onCaptureHandled, onStatus, recording, recordDisabled, onToggleRecording }: Props) {
  const [historyTarget,setHistoryTarget]=useState<HTMLSpanElement|null>(null);
  const [items, setItems] = useState<NoteNode[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [appearances, setAppearances] = useState<Record<string, PageAppearance>>({});
  const [note, setNote] = useState<MarkdownNote | null>(null);
  const draft = useRef<MarkdownNote | null>(null), dirty = useRef(false), saving = useRef<Promise<void> | null>(null);
  const editorDraft = useRef<(() => Pick<MarkdownNote, 'content' | 'document'>) | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [loadVersion, setLoadVersion] = useState(0);
  const handledCapture = useRef<number | null>(null);
  const [saved, setSaved] = useState(true), [ready, setReady] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [visited, setVisited] = useState(visible);
  const [creating, setCreating] = useState<{ kind: 'folder' | 'note' | 'database'; parentId?: string } | null>(null);
  const [search, setSearch] = useState(''), [label, setLabel] = useState('');
  const [organizing, setOrganizing] = useState<{ id: string; mode: 'rename' | 'move' } | null>(null);
  const [destination, setDestination] = useState(''), [rename, setRename] = useState('');
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [createMenu, setCreateMenu] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState('');
  const [tool, setTool] = useState<{kind:PageTool;note:MarkdownNote|null}|null>(null);
  const [presenting,setPresenting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null), importParent = useRef<string|undefined>(undefined);
  const choose = (value: MarkdownNote | null) => { clearTimeout(saveTimer.current); editorDraft.current = null; draft.current = value; dirty.current = false; setNote(value); setSaved(true); setLoadVersion(current => current + 1); };
  const materialize = () => { if (editorDraft.current && draft.current) { draft.current = { ...draft.current, ...editorDraft.current(), html: undefined }; editorDraft.current = null; } };
  const change = (patch: Partial<MarkdownNote>) => { if (!draft.current) return; if ('content' in patch) { materialize(); setLoadVersion(current => current + 1); } draft.current = { ...draft.current, ...patch }; dirty.current = true; setNote(draft.current); setSaved(false); };
  const list = async () => { const value = await window.localflow.notesList(); setItems(value.items); return value.items; };
  const flush = async (): Promise<void> => {
    if (saving.current) return saving.current;
    const task = (async () => {
      while (dirty.current && draft.current) {
        materialize();
        const before = draft.current, result = await window.localflow.notesSave(before);
        if (draft.current?.id !== before.id) return;
        const unchanged = draft.current === before && !editorDraft.current;
        draft.current = unchanged ? result : { ...draft.current, revision: result.revision };
        dirty.current = !unchanged; setNote(draft.current); setSaved(unchanged);
      }
    })();
    saving.current = task;
    try { await task; } catch (error) { materialize(); setNote(draft.current); throw error; } finally { saving.current = null; }
  };
  const flushRef = useRef(flush); flushRef.current = flush;
  const scheduleSave = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushRef.current().catch(error => setError(String(error))); }, 650);
  };
  const editorChanged = (read: () => Pick<MarkdownNote, 'content' | 'document'>) => { editorDraft.current = read; dirty.current = true; setSaved(false); scheduleSave(); };
  const run = async (work: () => Promise<unknown>) => { setPending(true); try { setError(''); await work(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setPending(false); } };
  const rememberTab = (id: string, newTab = false) => setTabs(current => current.includes(id) ? current : newTab || !current.includes(selectedId) ? [...current, id] : current.map(value => value === selectedId ? id : value));
  const open = async (id: string, newTab = false, tree = items) => {
    await flush(); const item = find(tree, id); if (!item) return;
    const next = item.kind === 'note' ? await window.localflow.notesRead(id) : null;
    rememberTab(id, newTab); setSelectedId(id); choose(next); onOpen();
  };
  const select = (reference: string, newTab = false) => { const [id, anchor = ''] = reference.split('#'); if (!pending) { setBlockTarget(''); void run(async () => { await open(id, newTab); setBlockTarget(anchor); }); } };
  const beginCreate = (kind: 'folder' | 'note' | 'database', parentId?: string) => { setCreating({ kind, parentId: kind !== 'note' && find(items, parentId || '')?.kind === 'database' ? parentOf(items, parentId!) : parentId }); setLabel(''); setCreateMenu(false); };
  const create = () => run(async () => {
    if (!creating) return; await flush();
    const item = await window.localflow.notesCreate({ ...creating, label }); const tree = await list();
    setCreating(null); setLabel(''); setSearch(''); await open(item.id, true, tree);
  });
  const move = (id: string, parentId?: string, beforeId?: string) => void run(async () => { await flush(); await window.localflow.notesMove({ id, parentId, beforeId }); await list(); });
  const closeTab = (id: string) => void run(async () => {
    await flush(); const next = tabs.filter(tab => tab !== id); setTabs(next);
    if (id === selectedId) { const nextId = next[Math.min(tabs.indexOf(id), next.length - 1)]; if (nextId) { setSelectedId(nextId); choose(find(items, nextId)?.kind === 'note' ? await window.localflow.notesRead(nextId) : null); } else { setSelectedId(''); choose(null); } }
  });
  useEffect(() => {
    let mounted = true;
    void run(async () => {
      const value = await window.localflow.notesImport(loadNotes(window.localStorage)); if (!mounted) return;
      const session = loadPageSession(window.localStorage), existing = session.tabs.filter(id => find(value.items, id));
      const id = existing.includes(session.active) ? session.active : existing[0] || firstNote(value.items) || value.items[0]?.id || '';
      setItems(value.items); setTabs(existing.length ? existing : id ? [id] : []); setAppearances(session.appearances); setSelectedId(id);
      if (find(value.items, id)?.kind === 'note') choose(await window.localflow.notesRead(id)); setReady(true);
    });
    const off = window.localflow.onNiwaEvent(event => {
      if (event.type !== 'notes-changed') return;
      void (async () => {
        const tree = event.tree !== false ? await list() : null;
        if (dirty.current || saving.current || !draft.current) return;
        const before = draft.current;
        if (tree && !find(tree, before.id)) { choose(null); return; }
        if (event.ids?.length && !event.ids.includes(before.id)) return;
        const next = await window.localflow.notesRead(before.id); if (draft.current === before && !dirty.current && next.revision !== before.revision) choose(next);
      })().catch(error => setError(String(error)));
    });
    return () => { mounted = false; off(); };
  }, []);
  useEffect(() => { if (ready) savePageSession(window.localStorage, { tabs, active: selectedId, appearances }); }, [tabs, selectedId, appearances, ready]);
  useEffect(() => { if (visible) setVisited(true); }, [visible]);
  useEffect(() => { if (!saved && !error) scheduleSave(); }, [note, saved, error]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    const saveBeforeQuit = (event: Event) => {
      event.preventDefault();
      const { resolve, reject } = (event as CustomEvent).detail;
      void flushRef.current().then(resolve, reject);
    };
    window.addEventListener('localflow-save-before-quit', saveBeforeQuit);
    return () => window.removeEventListener('localflow-save-before-quit', saveBeforeQuit);
  }, []);
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!visible || pending || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void run(flush); }
      if (event.key.toLowerCase() === 'w' && selectedId) { event.preventDefault(); closeTab(selectedId); }
      if (event.key === 'Tab' && tabs.length > 1) { event.preventDefault(); select(tabs[(tabs.indexOf(selectedId) + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length]); }
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [visible, pending, selectedId, tabs]);
  const selected = find(items, selectedId), menuNode = menu ? find(items, menu.id) : undefined;
  const automaticWide = useMemo(() => {
    const hasColumns = (node: import('@tiptap/core').JSONContent): boolean => node.type === 'columns' || Boolean(node.content?.some(hasColumns));
    return note?.document ? hasColumns(note.document) : Boolean(note?.html && new DOMParser().parseFromString(note.html, 'text/html').querySelector('[data-type="columns"],.column-list'));
  }, [note?.document, note?.html]);
  const parentId = selectedId || undefined, parent = parentOf(items, selectedId), appearance: PageAppearance = {wide:automaticWide,...appearances[selectedId],...note?.presentation};
  const filtered = (values: NoteNode[]): NoteNode[] => values.flatMap(value => { const children = filtered(value.children || []); return value.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || children.length ? [{ ...value, children }] : []; });
  const command = (id: string, action: PageAction) => {
    if (action === 'import') { importParent.current=id; importInput.current?.click(); return; }
    if (action === 'tab') return select(id, true);
    if (action === 'note' || action === 'folder' || action === 'database') return beginCreate(action, id);
    if (action === 'delete') return setDeleting(id);
    if (action === 'rename' || action === 'move') { setOrganizing({ id, mode: action }); setRename(find(items, id)?.label || ''); setDestination(parentOf(items, id) || ''); return; }
    void run(async () => {
      await flush();
      if (action === 'trash') { setTool({kind:'trash',note:null}); return; }
      if (action === 'notion') { const result=await window.localflow.notesImportNotion(); if(result)setItems(result.items); return; }
      if (action === 'duplicate') { const item = await window.localflow.notesDuplicate({ id }); const tree = await list(); await open(item.id, true, tree); return; }
      const value = await window.localflow.notesRead(id);
      if (action === 'link') { await window.localflow.copyText(`localflow-note://${id}`); onStatus('Page link copied'); return; }
      if (['history','ai','suggest','translate','info'].includes(action)) { setTool({kind:action as PageTool,note:value}); return; }
      if (action === 'present' || action === 'customize') {
        if (id !== selectedId) await open(id);
        if (action === 'present') setPresenting(true);
        else requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Page design"]')?.click());
        return;
      }
      if (action === 'markdown') await window.localflow.exportText({ text: value.content, defaultName: `${value.label.replace(/[<>:"/\\|?*]/g, '-')}.md` });
      if (action === 'copy') { await window.localflow.copyText(value.content); onStatus('Markdown copied'); }
      if (action === 'pdf') {
        if (id !== selectedId) await open(id, false);
        // Wait for the target editor, including its lazy first mount, before capturing the page.
        let editor: HTMLElement | null = null;
        for (let attempt = 0; attempt < 100; attempt++) {
          editor = document.querySelector('.noteWorkspace:not([hidden]) .richNoteEditor');
          if (editor?.dataset.noteId === id && editor.querySelector('.noteProse')) break;
          editor = null; await new Promise(resolve => setTimeout(resolve, 30));
        }
        window.dispatchEvent(new Event('localflow-notes-print'));
        for(let attempt=0;attempt<100;attempt++){
          await new Promise(resolve=>setTimeout(resolve,30));
          if(!editor?.querySelector('.databaseEmbedPlaceholder,.noteDatabaseEmbed .noteFolderState'))break;
          if(attempt===99)throw new Error('A database is still loading. Try exporting again.');
        }
        await (await import('../lib/lazy-math')).mathReady();
        const html = editor?.querySelector('.noteProse')?.innerHTML;
        if (!html) throw new Error('Open this page and try exporting again.');
        const path = await window.localflow.notesExportPdf({ title: value.label, html }); if (path) onStatus(`PDF saved: ${path}`);
      }
    });
  };
  useEffect(() => {
    if (!ready || !capture || handledCapture.current === capture.id) return; handledCapture.current = capture.id;
    void run(async () => {
      await flush();
      if (!draft.current || draft.current.presentation?.locked) { const item = await window.localflow.notesCreate({ label: `Voice note ${new Date().toLocaleString()}`, parentId }); rememberTab(item.id, true); setSelectedId(item.id); choose(await window.localflow.notesRead(item.id)); }
      const current = draft.current!;
      change({ content: [current.content, capture.text].filter(Boolean).join('\n\n'), document: current.document ? { ...current.document, content: [...(current.document.content || []), { type: 'paragraph', content: [{ type: 'text', text: capture.text }] }] } : undefined, html: undefined });
      await flush(); onStatus('Voice transcript saved to Markdown'); onCaptureHandled();
    });
  }, [capture, ready]);
  const updateAppearance = (id:string, patch:PageAppearance) => void run(async()=>{
    await flush(); const value=await window.localflow.notesRead(id);
    const next=await window.localflow.notesSave({...value,presentation:{...appearances[id],...value.presentation,...patch}});
    if(id===selectedId)choose(next); await list();
  });
  const words = useMemo(()=>{ if(!note || menu?.id!==note.id)return undefined; let count=0; for(const part of new Intl.Segmenter(undefined,{granularity:'word'}).segment(note.content))if(part.isWordLike)count++; return count; },[note?.content,menu?.id]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setPresenting(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(!visible || pending || !selectedId || !(event.ctrlKey||event.metaKey))return;
      const input=(event.target as HTMLElement).closest('input,textarea,[contenteditable=true]');
      if(event.key.toLowerCase()==='p'&&event.altKey&&selected?.kind==='note'){event.preventDefault();command(selectedId,'present');}
      else if(event.key.toLowerCase()==='p'&&event.shiftKey){event.preventDefault();command(selectedId,'move');}
      else if(!input&&event.key.toLowerCase()==='d'){event.preventDefault();command(selectedId,'duplicate');}
      else if(!input&&event.key.toLowerCase()==='l'&&selected?.kind==='note'){event.preventDefault();command(selectedId,'link');}
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[visible,pending,selectedId,note]);
  const showMenu = (id: string, x: number, y: number) => setMenu({ id, x, y });
  return <>
    {header && visible && createPortal(parent ? <button className="notesBreadcrumb" aria-label="Back to folder" onClick={() => select(parent)}><ArrowLeft size={14} />{find(items, parent)?.label}</button> : <strong>Notes</strong>, header)}
    {sidebar && visible && createPortal(<aside className="notesTreePane" aria-label="Notes folders">
      <div className="notesTreeToolbar"><strong>Notes</strong><div><button aria-label="New note" title="New page" disabled={!ready || pending} onClick={() => beginCreate('note', parentId)}><FilePlus2 size={16} /></button><button aria-label="Notes menu" title="Notes menu" aria-expanded={createMenu} onClick={() => setCreateMenu(!createMenu)}><MoreHorizontal size={16} /></button></div></div>
      {createMenu && <div className="notesCreateMenu"><button onClick={() => beginCreate('note', parentId)}><FilePlus2 size={15} />New page</button><button aria-label="New folder" onClick={() => beginCreate('folder', parentId)}><FolderPlus size={15} />New folder</button><button aria-label="New database" onClick={() => beginCreate('database', parentId)}><Database size={15} />New database</button><button onClick={() => beginCreate('note')}><Plus size={15} />New top-level page</button><button onClick={()=>{setCreateMenu(false);void run(async()=>{await flush();setTool({kind:'trash',note:null});});}}>Trash</button><button aria-label="Import Notion" disabled={!ready || pending} onClick={() => { setCreateMenu(false); void run(async () => { await flush(); onStatus('Importing Notion…'); const result = await window.localflow.notesImportNotion(); if (result) { setItems(result.items); onStatus(result.alreadyImported ? 'This export is already imported' : `${result.report.pages} pages · ${result.report.databases} databases imported`); } }); }}><Upload size={15} />Import Notion</button></div>}
      <input className="notesSearch" aria-label="Search notes" placeholder="Search notes" value={search} onChange={event => setSearch(event.target.value)} />
      <NotesTree items={search ? filtered(items) : items} searching={Boolean(search)} selected={selectedId} open={select} menu={showMenu} create={id => beginCreate('note', id)} move={move} />
    </aside>, sidebar)}
    <section className="noteWorkspace" data-presenting={presenting} data-locked={Boolean(note?.presentation?.locked)} hidden={!visible} data-page-font={appearance.font || 'default'} data-page-small={Boolean(appearance.small)} data-page-wide={Boolean(appearance.wide)}>
      {presenting && <button className="noteExitPresentation" onClick={()=>setPresenting(false)}>Exit presentation · Esc</button>}
      <div className="notePageTabBar">
      <PageTabs pages={tabs.map(id => find(items, id)).filter((item): item is NoteNode => Boolean(item))} active={selectedId} select={id => select(id)} close={closeTab} create={() => beginCreate('note')} move={(id, before) => setTabs(current => { if (!current.includes(id) || id === before) return current; const next = current.filter(value => value !== id); next.splice(next.indexOf(before), 0, id); return next; })} />
        {selected && <div className="notePageCommands"><span className="noteHistory" ref={setHistoryTarget}/><button aria-label="Page actions" title="Page actions" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); showMenu(selectedId, rect.right - 250, rect.bottom); }}><MoreHorizontal size={18} /></button></div>}
      </div>
      {error && <div className="errorBox" role="alert">{error}{note && <div><button onClick={() => void run(async () => { choose(await window.localflow.notesRead(note.id)); })}>Reload saved note</button><button onClick={() => void run(async () => { const item = await window.localflow.notesCreate({ label: `${note.label} (copy)`, content: note.content, document: note.document, html: note.html, parentId }); const tree = await list(); choose(null); await open(item.id, true, tree); })}>Save draft as copy</button></div>}</div>}
      {selected?.kind === 'database' ? <Suspense fallback={<div className="noteFolderState">Loading database…</div>}><DatabasePage key={selected.id} id={selected.id} label={selected.label} open={id => select(id)} /></Suspense> : note ? <div className="noteDocumentScroll">
        {note.presentation?.cover && <img className="notePageCover" src={assetUrl(note.presentation.cover)} style={{objectPosition:`center ${note.presentation.coverPosition ?? 50}%`}} alt=""/>}
        {(note.presentation?.icon || note.presentation?.iconText) && <div className="notePageIcon" data-cover={Boolean(note.presentation.cover)}>{note.presentation.iconText ? <span>{note.presentation.iconText}</span> : <img src={assetUrl(note.presentation.icon)} alt=""/>}</div>}
        {!note.presentation?.locked && <PageDesign key={note.id} value={note.presentation} change={presentation => change({ presentation })}/>}
        <header className="noteEditorHeader"><div><input className="noteTitleInput" readOnly={note.presentation?.locked || presenting} value={note.label} aria-label="Note title" onChange={event => change({ label: event.target.value })} /><span title={note.path}>{saved ? 'Saved' : 'Saving…'}</span></div><div className="noteEditorActions"><button className={recording ? 'recording' : ''} title={recording ? 'Stop transcription' : 'Transcribe to this page'} aria-label={recording ? 'Stop transcription' : 'Transcribe to this page'} disabled={recordDisabled || note.presentation?.locked} onClick={onToggleRecording}>{recording ? <Square size={15} /> : <Mic size={16} />}</button></div></header>
        {find(items, parentOf(items, note.id) || '')?.kind === 'database' && <RowProperties databaseId={parentOf(items, note.id)!} pageId={note.id} />}
        {note.presentation?.wiki && <WikiContents noteId={note.id} children={selected?.children || []} select={select}/> }
        <Suspense fallback={<div className="noteFolderState">Loading editor…</div>}>{visited && <NoteEditor key={note.id} noteId={note.id} loadVersion={loadVersion} blockTarget={blockTarget} editable={!note.presentation?.locked && !presenting} historyTarget={historyTarget} content={note.content} document={note.document} html={note.html} onOpenNote={id => select(id)} onChange={editorChanged} />}</Suspense>
        {selected?.children?.length ? <details className="noteChildPages"><summary>Pages inside · {selected.children.length}</summary><nav className="noteSubpages">{selected.children.map(child => <button key={child.id} onClick={event => select(child.id, event.ctrlKey || event.metaKey)} onContextMenu={event => { event.preventDefault(); showMenu(child.id, event.clientX, event.clientY); }}>{child.kind === 'database' ? <Database size={15} /> : <FilePlus2 size={15} />}{child.label}</button>)}</nav></details> : null}
      </div> : <div className="noteFolderState"><Folder size={30} /><strong>{selected?.label || 'Notes'}</strong><div className="notesFolderChildren">{selected?.children?.map(child => <button key={child.id} onClick={event => select(child.id, event.ctrlKey || event.metaKey)} onContextMenu={event => { event.preventDefault(); showMenu(child.id, event.clientX, event.clientY); }}>{child.kind === 'database' ? <Database size={15} /> : child.kind === 'folder' ? <Folder size={15} /> : <FilePlus2 size={15} />}{child.label}</button>)}</div><button disabled={!ready} onClick={() => beginCreate('note', parentId)}><FilePlus2 size={16} /> New note</button></div>}
    </section>
    {menu && menuNode && <PageMenu node={menu.id===note?.id?note:menuNode} x={menu.x} y={menu.y} close={() => setMenu(null)} action={action => command(menu.id, action)} words={menu.id===note?.id?words:undefined} appearance={{...appearances[menu.id],...menuNode.presentation,...(menu.id===note?.id?appearance:{})}} changeAppearance={patch => updateAppearance(menu.id,patch)} />}
    <input ref={importInput} hidden type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" aria-label="Import page file" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void run(async()=>{if(file.size>2_000_000)throw new Error('Page files must be at most 2 MB.');await flush();const value=await window.localflow.notesCreate({label:file.name.replace(/\.[^.]+$/,'').slice(0,300)||'Imported page',content:await file.text(),parentId:importParent.current});const tree=await list();await open(value.id,true,tree);});}}/>
    {tool && <PageTools key={`${tool.kind}-${tool.note?.id}`} tool={tool.kind} note={tool.note} close={()=>setTool(null)} refreshed={async id=>{const tree=await list();if(id)await open(id,true,tree);}}/>}
    {(creating || organizing || deleting) && createPortal(<div className="notesDialogBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) { setCreating(null); setOrganizing(null); setDeleting(null); } }}><div role="dialog" aria-modal="true" aria-label={creating ? `New ${creating.kind}` : organizing ? 'Organize page' : 'Move page to Trash'} className="notesPageDialog" onKeyDown={event => { if (event.key === 'Escape') { setCreating(null); setOrganizing(null); setDeleting(null); } }}>
      <button className="notesDialogClose" aria-label="Close dialog" onClick={() => { setCreating(null); setOrganizing(null); setDeleting(null); }}><X size={16} /></button>
      {creating && <form onSubmit={event => { event.preventDefault(); void create(); }}><h3>New {creating.kind === 'note' ? 'page' : creating.kind}</h3><input autoFocus aria-label={creating.kind === 'folder' ? 'Folder name' : 'Note title'} placeholder="Untitled" value={label} onChange={event => setLabel(event.target.value)} /><label>Location<select aria-label="Create in" value={creating.parentId || ''} onChange={event => setCreating({ ...creating, parentId: event.target.value || undefined })}><option value="">Notes root</option>{allNodes(items).filter(item => creating.kind === 'note' || item.kind !== 'database').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button aria-label={`Create ${creating.kind}`} disabled={!label.trim() || pending}><Check size={15} />Create</button></form>}
      {organizing && <form onSubmit={event => { event.preventDefault(); void run(async () => { await flush(); if (organizing.mode === 'rename') await window.localflow.notesRename({ id: organizing.id, label: rename }); else await window.localflow.notesMove({ id: organizing.id, parentId: destination || undefined }); await list(); if (draft.current?.id === organizing.id) choose(await window.localflow.notesRead(organizing.id)); setOrganizing(null); }); }}><h3>{organizing.mode === 'rename' ? 'Rename' : 'Move to'}</h3>{organizing.mode === 'rename' ? <input autoFocus aria-label="Rename note or folder" required value={rename} onChange={event => setRename(event.target.value)} /> : <select autoFocus aria-label="Move to" value={destination} onChange={event => setDestination(event.target.value)}><option value="">Notes root</option>{allNodes(items).filter(item => item.id !== organizing.id && (find(items, organizing.id)?.kind === 'note' || item.kind !== 'database') && !find(find(items, organizing.id)?.children || [], item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}<button disabled={pending}>Save</button></form>}
      {deleting && <><h3>Move to Trash: “{find(items, deleting)?.label}”?</h3><p>Includes child pages and databases. You can restore them from Trash.</p><button className="danger" disabled={pending} onClick={() => void run(async () => { await flush(); const next = await window.localflow.notesRemove(deleting); setItems(next.items); const retained = tabs.filter(id => find(next.items, id)); setTabs(retained); if (!find(next.items, selectedId)) { setSelectedId(retained[0] || ''); choose(retained[0] && find(next.items, retained[0])?.kind === 'note' ? await window.localflow.notesRead(retained[0]) : null); } setDeleting(null); })}>Move to Trash</button></>}
    </div></div>, document.body)}
  </>;
}
