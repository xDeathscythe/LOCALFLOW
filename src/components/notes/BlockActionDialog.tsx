import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DOMSerializer, DOMParser as SchemaParser } from '@tiptap/pm/model';
import type { Editor, JSONContent } from '@tiptap/core';
import type { NoteNode } from '../../lib/workspace';
import { MarkdownContent } from '../MarkdownContent';
import { blockContent, currentBlock, replaceCurrentBlock } from './block-actions';

const titles: Record<string, string> = { improve: 'Improve writing', proofread: 'Proofread', explain: 'Explain', reformat: 'Reformat', ask: 'Ask AI', suggest: 'Suggest edits', comment: 'Comments', move: 'Move to page', page: 'Turn into page', 'page-in': 'Turn into page in…', 'list-start': 'Start numbering at', math: 'Block equation', synced: 'Synced block' };
type Comment = { id: string; text: string; createdAt: string; resolved?: boolean };
export function BlockActionDialog({ editor, kind, noteId, close }: { editor: Editor; kind: string; noteId?: string; close: () => void }) {
  const [block] = useState(() => currentBlock(editor)!);
  const [original] = useState(() => JSON.stringify(editor.getJSON()));
  const [content] = useState(() => blockContent(editor));
  const [input, setInput] = useState(['page', 'page-in', 'synced'].includes(kind) ? block.node.textContent.slice(0, 100) : kind === 'math' ? block.node.textContent : kind === 'list-start' ? String(editor.getAttributes('orderedList').start || 1) : '');
  const [result, setResult] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState(''), [pages, setPages] = useState<NoteNode[]>([]), [destination, setDestination] = useState('');
  const [comments, setComments] = useState<Comment[]>(block.node.attrs.comments || []);
  const live = useRef(true), started = useRef(false), panel = useRef<HTMLDivElement>(null);
  const skill = ['improve', 'proofread', 'explain', 'reformat', 'ask', 'suggest'].includes(kind);
  const markdown = (nodes: JSONContent[]) => editor.markdown!.serialize({ type: 'doc', content: nodes });
  const unchanged = () => { if (editor.isDestroyed || JSON.stringify(editor.getJSON()) !== original) throw new Error('The page changed while this dialog was open. Close and reopen it to use the latest block.'); };
  const run = async (task: () => Promise<unknown> | unknown) => { setPending(true); setError(''); try { await task(); } catch (failure) { if (live.current) setError(String(failure)); } finally { if (live.current) setPending(false); } };
  const generate = () => run(async () => { const value = await window.localflow.notesSkill({ skill: kind, text: markdown(content), prompt: input }); if (live.current) setResult(value); });
  useEffect(() => {
    live.current = true; editor.setEditable(false, false); panel.current?.focus();
    if (['move', 'page-in'].includes(kind)) void window.localflow.notesList().then(value => { const flatten = (nodes: NoteNode[]): NoteNode[] => nodes.flatMap(node => [...(node.kind === 'note' && node.id !== noteId ? [node] : []), ...flatten(node.children || [])]); if (live.current) setPages(flatten(value.items)); }).catch(error => setError(String(error)));
    if (skill && kind !== 'ask' && !started.current) { started.current = true; void generate(); }
    return () => { live.current = false; if (!editor.isDestroyed) editor.setEditable(true, false); };
  }, []);
  const replace = (nodes: JSONContent[]) => {
    unchanged();
    editor.commands.setNodeSelection(block.from);
    if (nodes[0]) nodes[0] = { ...nodes[0], attrs: { ...block.node.attrs, ...nodes[0].attrs } };
    if (!replaceCurrentBlock(editor, nodes)) throw new Error('This result cannot replace the selected block.');
    close();
  };
  const applyResult = (below: boolean) => run(() => {
    const nodes = editor.markdown!.parse(result).content || [];
    if (!below) return replace(nodes);
    unchanged();
    const items = ['listItem', 'taskItem'].includes(block.node.type.name) ? [{ type: block.node.type.name, attrs: { checked: false }, content: nodes[0]?.type === 'paragraph' ? nodes : [{ type: 'paragraph' }, ...nodes] }] : nodes;
    editor.commands.insertContentAt(block.to, items); close();
  });
  const saveComments = (next: Comment[]) => {
    const current = editor.state.doc.nodeAt(block.from);
    if (!current || current.type !== block.node.type || current.textContent !== block.node.textContent) throw new Error('This block changed. Reopen its comments.');
    editor.view.dispatch(editor.state.tr.setNodeMarkup(block.from, undefined, { ...current.attrs, comments: next })); setComments(next); setInput('');
  };
  const submit = () => run(async () => {
    if (kind === 'comment') return saveComments([...comments, { id: crypto.randomUUID(), text: input.trim(), createdAt: new Date().toISOString() }]);
    if (kind === 'ask' || kind === 'suggest') return generate();
    if (kind === 'math') return replace([{ type: 'blockMath', attrs: { latex: input } }]);
    if (kind === 'list-start') { unchanged(); const start = Number(input); if (!Number.isSafeInteger(start) || start < 1 || start > 1000000) throw new Error('Enter a whole number from 1 to 1000000.'); editor.commands.updateAttributes('orderedList', { start }); close(); return; }
    unchanged();
    if (kind === 'move') {
      const target = await window.localflow.notesRead(destination);
      // Parse older Markdown/HTML pages with the same editor schema, preserving rich pages as JSON.
      const targetDoc = target.document || (target.html ? SchemaParser.fromSchema(editor.schema).parse(new DOMParser().parseFromString(target.html, 'text/html').body).toJSON() : editor.markdown!.parse(target.content));
      const document = { type: 'doc', content: [...(targetDoc.content || []), ...content] };
      unchanged(); await window.localflow.notesSave({ ...target, document, content: markdown(document.content), html: undefined });
      unchanged(); editor.commands.deleteRange({ from: block.from, to: block.to }); close(); return;
    }
    const page = await window.localflow.notesCreate({ label: input.trim(), parentId: kind === 'page-in' ? destination : noteId, content: markdown(content), document: { type: 'doc', content } });
    if (kind === 'synced') return replace([{ type: 'syncedBlock', attrs: { sourceId: page.id } }]);
    replace([{ type: 'paragraph', content: [{ type: 'text', text: page.label, marks: [{ type: 'link', attrs: { href: `localflow-note://${page.id}` } }] }] }]);
  });
  return createPortal(<div className="noteModalShade" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={panel} tabIndex={-1} className={`noteInsertDialog noteBlockDialog ${skill ? 'noteSkillDialog' : ''}`} role="dialog" aria-modal="true" aria-label={titles[kind]} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') { const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,[tabindex="0"]')]; if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); } }
  }}>
    <header><strong>{titles[kind]}</strong><button aria-label="Close block dialog" onClick={close}>×</button></header>
    {kind === 'comment' && <div className="noteComments">{comments.map(comment => <article key={comment.id} data-resolved={comment.resolved}><p>{comment.text}</p><time>{new Date(comment.createdAt).toLocaleString()}</time><button onClick={() => void run(() => saveComments(comments.map(item => item.id === comment.id ? { ...item, resolved: !item.resolved } : item)))}>{comment.resolved ? 'Reopen' : 'Resolve'}</button><button onClick={() => void run(() => saveComments(comments.filter(item => item.id !== comment.id)))}>Delete comment</button></article>)}{!comments.length && <p>No comments yet</p>}</div>}
    {skill && <div className="noteSkillSource"><small>Original</small><MarkdownContent content={markdown(content)} /></div>}
    {(!skill || kind === 'ask' || kind === 'suggest') && kind !== 'move' && <label>{kind === 'comment' ? 'Comment' : kind === 'ask' || kind === 'suggest' ? 'Instructions' : kind === 'list-start' ? 'Start at' : kind === 'math' ? 'LaTeX' : 'Page title'}<textarea aria-label="Block action input" value={input} onChange={event => setInput(event.target.value)} /></label>}
    {['move', 'page-in'].includes(kind) && <label>Destination<select aria-label="Destination page" value={destination} onChange={event => setDestination(event.target.value)}><option value="">Choose a page</option>{pages.map(page => <option key={page.id} value={page.id}>{page.label}</option>)}</select></label>}
    {pending && <p role="status">Working…</p>}
    {result && <div className="noteSkillResult"><small>Result</small><MarkdownContent content={result} /></div>}
    {error && <p role="alert">{error}</p>}
    {skill ? <><button disabled={pending || kind === 'ask' && !input.trim()} onClick={() => void generate()}>{result ? 'Try again' : 'Generate'}</button>{result && <><button disabled={pending} onClick={() => void applyResult(false)}>Replace block</button><button disabled={pending} onClick={() => void applyResult(true)}>Insert below</button><button onClick={() => void run(() => window.localflow.copyText(result))}>Copy result</button></>}</> : <button disabled={pending || (kind !== 'move' && !input.trim()) || ['move', 'page-in'].includes(kind) && !destination} onClick={() => void submit()}>{kind === 'comment' ? 'Add comment' : kind === 'move' ? 'Move block' : 'Apply'}</button>}
    <button onClick={close}>{result ? 'Discard' : 'Close'}</button>
  </div></div>, document.body);
}

export function BlockPresentation({ editor, close }: { editor: Editor; close: () => void }) {
  const [blocks] = useState(() => { const start = currentBlock(editor)?.from || 0, result: string[] = []; editor.state.doc.slice(start, editor.state.doc.content.size).content.forEach(node => { const div = document.createElement('div'); div.appendChild(DOMSerializer.fromSchema(editor.schema).serializeNode(node)); result.push(div.innerHTML); }); return result; });
  const [index, setIndex] = useState(0), panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.focus(); }, []);
  return createPortal(<div ref={panel} className="notePresentation" role="dialog" aria-modal="true" aria-label="Block presentation" tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') close(); if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); setIndex(value => Math.min(blocks.length - 1, value + 1)); } if (event.key === 'ArrowLeft') setIndex(value => Math.max(0, value - 1)); }}><header><span>{index + 1} / {blocks.length}</span><button onClick={close}>Exit presentation</button></header><div className="noteProse markdownBody" dangerouslySetInnerHTML={{ __html: blocks[index] || '' }} /><footer><button disabled={!index} onClick={() => setIndex(index - 1)}>Previous</button><button disabled={index >= blocks.length - 1} onClick={() => setIndex(index + 1)}>Next</button></footer></div>, document.body);
}
