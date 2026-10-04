import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plus, GripVertical, MoreHorizontal } from 'lucide-react';
import { noteExtensions } from './notes/extensions';
import { NoteHistory } from './notes/NoteHistory';
import { BlockMenu } from './notes/BlockMenu';
import { TablePicker } from './notes/TablePicker';
import { DatabasePicker } from './notes/DatabasePicker';
import { currentBlock, insertAfterBlock } from './notes/block-actions';
import { BlockActionDialog, BlockPresentation } from './notes/BlockActionDialog';
import 'katex/dist/katex.min.css';
import '../styles/note-editor.css';

type Position = { x: number; y: number };
type Asset = { url: string; name: string; mime: string; size: number };
export function NoteEditor({ content, document: noteDocument, html, loadVersion, noteId, blockTarget, historyTarget, editable = true, onChange, onOpenNote }: { content: string; document?: JSONContent; html?: string; loadVersion: number; noteId?: string; blockTarget?: string; historyTarget?: HTMLElement | null; editable?: boolean; onChange: (read: () => { content: string; document?: JSONContent }) => void; onOpenNote?: (id: string) => void }) {
  const [source, setSource] = useState(false), [link, setLink] = useState<string | null>(null), [table, setTable] = useState(false), [database, setDatabase] = useState<null | 'database' | 'note'>(null);
  const [sourceText, setSourceText] = useState('');
  const loadedVersion = useRef(loadVersion);
  const [equation, setEquation] = useState<string | null>(null), [error, setError] = useState(''), [uploading, setUploading] = useState(false);
  const [menu, setMenu] = useState<(Position & { mode: 'insert' | 'format' | 'block'; after?: boolean }) | null>(null);
  const [handle, setHandle] = useState<{ from: number; x: number; y: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const editableRef = useRef(editable); editableRef.current = editable;
  const [blockAction, setBlockAction] = useState<string | null>(null);
  useEffect(() => {
    const closeDialogs = (event: KeyboardEvent) => { if (event.key === 'Escape') { setTable(false); setDatabase(null); setEquation(null); setLink(null); } };
    document.addEventListener('keydown', closeDialogs);
    return () => document.removeEventListener('keydown', closeDialogs);
  }, []);
  const editor = useEditor({
    immediatelyRender: false, editable,
    extensions: noteExtensions(onOpenNote),
    content: noteDocument || html || content, contentType: noteDocument ? 'json' : html ? 'html' : 'markdown',
    editorProps: {
      attributes: { class: 'noteProse markdownBody', 'aria-label': 'Note content', role: 'textbox', 'aria-multiline': 'true' },
      handlePaste: (view, event) => {
        if (!view.editable) return true;
        const files = [...(event.clipboardData?.files || [])];
        if (files.length) { event.preventDefault(); void uploadFiles(files); return true; }
        const href = event.clipboardData?.getData('text/plain').trim() || '';
        if (!/^localflow-note:\/\/[\w-]{1,100}(?:#block-[\w-]{1,100})?$/.test(href)) return false;
        // Custom page URIs are structural links, independent of the page language.
        event.preventDefault();
        const mark = view.state.schema.marks.link.create({ href });
        view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text(href, [mark]), false));
        return true;
      },
      handleDrop: (view, event) => { if (!view.editable) return true; const files = [...(event.dataTransfer?.files || [])]; if (!files.length) return false; event.preventDefault(); const position = view.posAtCoords({ left: event.clientX, top: event.clientY }); if (position) editor?.commands.setTextSelection(position.pos); void uploadFiles(files); return true; },
      handleDOMEvents: {
        contextmenu: (view, event) => { if (!view.editable) return false; event.preventDefault(); if (view.state.selection.empty) { const position = view.posAtCoords({ left: event.clientX, top: event.clientY }); if (position) editor?.commands.setTextSelection(position.pos); } setMenu({ x: event.clientX, y: event.clientY, mode: 'block' }); return true; },
        click: (_view, event) => { const href = (event.target as HTMLElement).closest('a')?.getAttribute('href'); if (href?.startsWith('localflow-note:')) { event.preventDefault(); onOpenNote?.(href.replace(/^localflow-note:\/\//, '')); return true; } if (href?.startsWith('localflow-asset:')) { event.preventDefault(); void window.localflow.notesOpenAsset(href); return true; } return false; },
      },
    },
    onUpdate: ({ editor }) => onChange(() => ({ content: editor.getMarkdown(), document: editor.getJSON() })),
  });
  useEffect(() => {
    editor?.setEditable(editable && !uploading, false);
    if (!editable) { setHandle(null); setMenu(null); setBlockAction(null); setTable(false); setDatabase(null); setEquation(null); setLink(null); setSource(false); }
  }, [editor, editable, uploading]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || loadedVersion.current === loadVersion) return;
    loadedVersion.current = loadVersion;
    editor.commands.setContent(noteDocument || html || content, { contentType: noteDocument ? 'json' : html ? 'html' : 'markdown', emitUpdate: false });
    if (source) setSourceText(content);
  }, [editor, loadVersion, content, noteDocument, html, source]);
  useEffect(() => { if (editor && blockTarget) requestAnimationFrame(() => { const element = document.getElementById(blockTarget); element?.scrollIntoView({ block: 'center' }); element?.animate([{ outline: '2px solid #8095b7' }, { outline: '2px solid transparent' }], 1800); }); }, [editor, blockTarget]);
  const addAssets = async (load: () => Promise<Asset[]>) => {
    if (!editor || editor.isDestroyed || uploading || !editableRef.current) return;
    // Pasting another file next to a selected image must not replace that image.
    if (editor.state.selection instanceof NodeSelection) insertAfterBlock(editor);
    setError(''); setUploading(true); editor.setEditable(false, false);
    try { const assets = await load(); if (!editor.isDestroyed && editableRef.current && assets.length) editor.chain().insertContent(assets.map(asset => asset.mime.startsWith('image/') ? { type: 'image', attrs: { src: asset.url, alt: asset.name } } : { type: 'attachment', attrs: { href: asset.url, title: asset.name } })).run(); }
    catch (e) { setError(String(e)); }
    finally { if (!editor.isDestroyed) { editor.setEditable(editableRef.current, false); if (editableRef.current) editor.commands.focus(); } setUploading(false); }
  };
  const uploadFiles = (files: File[]) => addAssets(async () => {
    if (files.length > 30 || files.some(file => file.size > 50_000_000) || files.reduce((total, file) => total + file.size, 0) > 150_000_000) throw new Error('Choose up to 30 files, at most 50 MB each and 150 MB together.');
    return window.localflow.notesUploadAssets(await Promise.all(files.map(async file => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }))));
  });
  if (!editor || editor.isDestroyed) return null;
  const openMenu = (event: React.MouseEvent<HTMLElement>, mode: 'insert' | 'block') => {
    const { selection } = editor.state;
    const after = mode === 'insert' && !(selection.empty && selection.$from.parent.type.name === 'paragraph' && !selection.$from.parent.content.size);
    const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 6, mode, after });
  };
  const selectHandle = () => { if (handle) editor.commands.setNodeSelection(handle.from); };
  return <div className="richNoteEditor contextualNoteEditor" data-note-id={noteId} ref={container}>
    {editable && historyTarget && <NoteHistory editor={editor} target={historyTarget}/>}
    {editable && <div className="noteQuickTools">
      {source ? <button className="noteSourceToggle" onClick={() => { editor.commands.setContent(sourceText, { contentType: 'markdown', emitUpdate: false }); setSource(false); }}>Back to editor</button> : <button aria-label="Insert block" title="Insert block (or type /)" disabled={uploading} onMouseDown={e => e.preventDefault()} onClick={event => openMenu(event, 'insert')}><Plus size={17} /></button>}
      {!source && <button aria-label="Editor options" title="Editor options" onMouseDown={e => e.preventDefault()} onClick={event => openMenu(event, 'block')}><MoreHorizontal size={17} /></button>}
      {uploading && <span role="status">Adding files…</span>}
    </div>}
    {error && <div className="noteEditorError" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss upload error">×</button></div>}
    {menu && <BlockMenu editor={editor} noteId={noteId} position={menu} mode={menu.mode} action={id => {
      if (id === 'copy-link') {
        const block = currentBlock(editor); if (!block || !noteId) return;
        const blockId = block.node.attrs.blockId || crypto.randomUUID();
        editor.view.dispatch(editor.state.tr.setNodeMarkup(block.from, undefined, { ...block.node.attrs, blockId }));
        void window.localflow.copyText(`localflow-note://${noteId}#block-${blockId}`).catch(error => setError(String(error)));
      } else setBlockAction(id);
    }} prepare={()=>{if(menu.after)insertAfterBlock(editor);}} close={() => setMenu(null)} table={() => setTable(true)} link={() => setLink(editor.getAttributes('link').href || '')} image={() => void addAssets(() => window.localflow.notesPickAssets())} equation={() => setEquation(editor.getAttributes('blockMath').latex || '')} database={() => setDatabase('database')} page={() => setDatabase('note')} source={() => { setSourceText(editor.getMarkdown()); setSource(true); }} />}
    {blockAction && (blockAction === 'present' ? <BlockPresentation editor={editor} close={() => setBlockAction(null)} /> : <BlockActionDialog editor={editor} noteId={noteId} kind={blockAction} close={() => setBlockAction(null)} />)}
    {table && <div className="noteModalShade" onMouseDown={event => { if (event.target === event.currentTarget) setTable(false); }}><div role="dialog" aria-modal="true" aria-label="Insert table"><TablePicker close={() => setTable(false)} insert={(rows, cols, withHeaderRow) => editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run()} /></div></div>}
    {database && <DatabasePicker noteId={noteId} kind={database} close={() => setDatabase(null)} insert={(id, label) => editor.chain().focus().insertContent(database === 'database' ? { type: 'databaseEmbed', attrs: { id, label } } : { type: 'paragraph', content: [{ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: 'localflow-note://' + id } }] }] }).run()} />}
    {equation !== null && <div className="noteModalShade"><form className="noteInsertDialog" role="dialog" aria-label="Equation" onSubmit={event => { event.preventDefault(); if (editor.isActive('blockMath')) editor.chain().focus().updateAttributes('blockMath', { latex: equation }).run(); else editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: equation } }).run(); setEquation(null); }}><label>LaTeX equation<input autoFocus required aria-label="LaTeX equation" placeholder="E = mc^2" value={equation} onChange={event => setEquation(event.target.value)} /></label><button>Insert</button><button type="button" onClick={() => setEquation(null)}>Cancel</button></form></div>}
    {link !== null && <div className="noteModalShade"><form className="noteInsertDialog" role="dialog" aria-label="Edit link" onSubmit={event => { event.preventDefault(); if (!link) editor.chain().focus().unsetLink().run(); else if (/^(https?:|mailto:|localflow-note:)/i.test(link)) editor.chain().focus().setLink({ href: link }).run(); else return; setLink(null); }}><input autoFocus aria-label="Link URL" placeholder="https://" value={link} onChange={event => setLink(event.target.value)} /><button>Apply</button><button type="button" onClick={() => setLink(null)}>Cancel</button></form></div>}
    {source ? <textarea className="noteMarkdownSource" aria-label="Markdown source" value={sourceText} onChange={event => { const value = event.target.value; setSourceText(value); onChange(() => ({ content: value, document: undefined })); }} spellCheck={false} /> : <>
      <EditorContent editor={editor} className="noteEditorScroll" onScrollCapture={() => { setHandle(null); setMenu(null); }} onMouseMove={event => {
        if (!editor.isEditable) return;
        if ((event.target as HTMLElement).closest('.noteDatabaseEmbed')) { setHandle(null); return; }
        const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        const block = pos && currentBlock(editor, pos.pos);
        const element = block && editor.view.nodeDOM(block.from);
        if (!(element instanceof HTMLElement) || !container.current) return;
        const rect = element.getBoundingClientRect(), parent = container.current.getBoundingClientRect();
        // Native list markers live outside the item box; keep controls outside the list gutter.
        const left = (element.matches('li') ? element.parentElement! : element).getBoundingClientRect().left;
        const x = left - parent.left - 42, y = rect.top - parent.top;
        setHandle(previous => previous?.from === block!.from && previous.x === x && previous.y === y ? previous : { from: block!.from, x, y });
      }} onMouseUp={event => { if (editor.isEditable && !editor.state.selection.empty && !(editor.state.selection instanceof NodeSelection) && !editor.isActive('table')) setMenu({ x: event.clientX, y: event.clientY + 12, mode: 'format' }); }} onKeyDown={event => { if (editor.isEditable && event.key === '/' && editor.state.selection.$from.parent.content.size === 0) { event.preventDefault(); const coords = editor.view.coordsAtPos(editor.state.selection.from); setMenu({ x: coords.left, y: coords.bottom + 8, mode: 'insert' }); } }} />
      {handle && <div className="noteBlockHandle" style={{ left: Math.max(2, handle.x), top: handle.y }}>
        <button title="Insert block below" aria-label="Insert block below" onMouseDown={e => e.preventDefault()} onClick={event => { selectHandle(); openMenu(event, 'insert'); }}><Plus size={14} /></button>
        <button title="Drag to move · Click for block actions" aria-label="Block actions" draggable onMouseDown={e => e.preventDefault()} onClick={event => { selectHandle(); openMenu(event, 'block'); }} onDragStart={event => {
          selectHandle(); const slice = editor.state.selection.content(); editor.view.dragging = { slice, move: true };
          const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content), wrapper = document.createElement('div'); wrapper.appendChild(fragment);
          event.dataTransfer.setData('text/html', wrapper.innerHTML); event.dataTransfer.setData('text/plain', slice.content.textBetween(0, slice.content.size, '\n')); event.dataTransfer.effectAllowed = 'move'; setMenu(null);
        }} onDragEnd={() => { editor.view.dragging = null; setHandle(null); }}><GripVertical size={14} /></button>
      </div>}
    </>}
  </div>;
}
