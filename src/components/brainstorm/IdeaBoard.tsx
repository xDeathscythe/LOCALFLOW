import { useRef, useState } from 'react';
import { ImagePlus, Link2, Plus, Trash2, Grip } from 'lucide-react';
import type { BoardPin, BrainstormAction, BrainstormSession } from '../../lib/brainstorm';
import type { NoteNode } from '../../lib/workspace';
import { assetUrl } from '../../lib/asset-url';

export function IdeaBoard({ session, run, busy }: { session: BrainstormSession; run: BrainstormAction; busy: boolean }) {
  const [text, setText] = useState(''), [url, setUrl] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [label, setLabel] = useState('');
  const [notes, setNotes] = useState<NoteNode[]>([]), [noteId, setNoteId] = useState('');
  const [position, setPosition] = useState<Record<string, { x: number; y: number }>>({});
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; left: number; top: number } | null>(null);
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null), connectionLabel = useRef<HTMLInputElement>(null);
  const attempt = async (work: () => Promise<unknown>) => { try { setError(''); await work(); } catch (e) { setError(String(e)); } };
  const pin = (value: Partial<BoardPin>) => run('pin', { id: session.id, pin: { id: crypto.randomUUID(), kind: 'text', title: 'Idea', body: '', x: 40 + (session.pins.length % 4) * 250, y: 40 + Math.floor(session.pins.length / 4) * 230, ...value } });
  const loadNotes = async () => { const result = await window.localflow.notesList(), pages: NoteNode[] = []; const walk = (items: NoteNode[]) => items.forEach(n => n.kind === 'note' ? pages.push(n) : walk(n.children || [])); walk(result.items); setNotes(pages); };
  const point = (p: BoardPin) => position[p.id] || p;
  const width = Math.max(1100, ...session.pins.map(p => point(p).x + 270)), height = Math.max(550, ...session.pins.map(p => point(p).y + 240));
  return <div className="brainBoard">
    <div className="brainBoardTools">
      <form onSubmit={e => { e.preventDefault(); void attempt(async () => { await pin({ kind: url ? 'link' : 'text', title: Array.from(text || url).slice(0, 100).join(''), body: text, ...(url ? { url } : {}) }); setText(current => current === text ? '' : current); setUrl(current => current === url ? '' : current); }); }}>
        <input aria-label="Pin text" placeholder="A thought, quote or event" value={text} maxLength={16000} onChange={e => setText(e.target.value)} />
        <input aria-label="Pin URL" placeholder="Optional link" type="url" value={url} maxLength={4000} onChange={e => setUrl(e.target.value)} /><button disabled={busy || !(text.trim() || url.trim())}><Plus size={15} />Pin</button>
      </form>
      <button disabled={busy} onClick={() => void attempt(async () => { let offset = session.pins.length; for (const asset of await window.localflow.notesPickAssets()) { if (asset.mime.startsWith('image/')) { await pin({ kind: 'image', title: asset.name, url: asset.url, x: 40 + offset % 4 * 250, y: 40 + Math.floor(offset / 4) * 230 }); offset++; } } })}><ImagePlus size={16} />Images</button>
      <details onToggle={e => { if (e.currentTarget.open) void attempt(loadNotes); }}><summary>Pin a Notes page</summary><form onSubmit={e => { e.preventDefault(); void attempt(async () => { const note = await window.localflow.notesRead(noteId); await pin({ kind: 'note', title: note.label.slice(0, 200), body: note.content.slice(0, 30000) }); }); }}><select aria-label="Notes page to pin" value={noteId} onChange={e => setNoteId(e.target.value)}><option value="">Choose a page</option>{notes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select><button disabled={busy || !noteId}>Pin page</button></form></details>
    </div>
    <div className="brainBoardViewport"><div className="brainBoardCanvas" ref={canvas} style={{ width, height }}>
      <svg width={width} height={height} aria-hidden="true">{session.edges.map(edge => {
        const a = session.pins.find(p => p.id === edge.from), b = session.pins.find(p => p.id === edge.to); if (!a || !b) return null;
        const p = point(a), q = point(b);
        return <g key={edge.id}><line className="artLine artThread" pathLength={1} x1={p.x + 110} y1={p.y + 65} x2={q.x + 110} y2={q.y + 65} /><text x={(p.x + q.x) / 2 + 110} y={(p.y + q.y) / 2 + 55}>{edge.label.slice(0, 45)}</text></g>;
      })}{wire && <line className="brainWirePreview" x1={point(session.pins.find(p => p.id === wire.from)!).x + 205} y1={point(session.pins.find(p => p.id === wire.from)!).y + 20} x2={wire.x} y2={wire.y} />}</svg>
      {session.pins.map(p => <article key={p.id} data-pin-id={p.id} className={`brainPin ${p.kind}`} style={{ left: point(p).x, top: point(p).y }}>
        <header><button aria-label={`Move ${p.title}`} title="Drag to move, or use arrow keys" disabled={busy} onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag({ id: p.id, x: e.clientX, y: e.clientY, left: point(p).x, top: point(p).y }); }} onPointerMove={e => { if (drag?.id === p.id) setPosition(current => ({ ...current, [p.id]: { x: Math.max(0, Math.min(5000, drag.left + e.clientX - drag.x)), y: Math.max(0, Math.min(5000, drag.top + e.clientY - drag.y)) } })); }} onPointerUp={() => { if (drag?.id === p.id) { setDrag(null); void attempt(async () => { await run('pin', { id: session.id, pin: { ...p, ...point(p) } }); }); } }} onPointerCancel={() => { setDrag(null); setPosition({}); }} onKeyDown={e => { const directions: Record<string, number[]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }; const step = directions[e.key]; if (!step) return; e.preventDefault(); void attempt(async () => { await run('pin', { id: session.id, pin: { ...p, x: Math.max(0, Math.min(5000, p.x + step[0])), y: Math.max(0, Math.min(5000, p.y + step[1])) } }); setPosition({}); }); }}><Grip size={15} /></button><strong>{p.title}</strong><button aria-label={`Remove ${p.title}`} disabled={busy} onClick={() => void attempt(() => run('unpin', { id: session.id, pinId: p.id }))}><Trash2 size={13} /></button></header>
        <button className="brainPinSocket" aria-label={`Draw a connection from ${p.title}`} title="Drag to another pin, then describe the connection" disabled={busy} onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); const rect = canvas.current!.getBoundingClientRect(); setWire({ from: p.id, x: e.clientX - rect.left, y: e.clientY - rect.top }); }} onPointerMove={e => { if (!wire) return; const rect = canvas.current!.getBoundingClientRect(); setWire({ ...wire, x: e.clientX - rect.left, y: e.clientY - rect.top }); }} onPointerUp={e => { const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pin-id]')?.getAttribute('data-pin-id'); if (wire && target && target !== p.id) { setFrom(p.id); setTo(target); connectionLabel.current?.focus(); } setWire(null); }} onPointerCancel={() => setWire(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFrom(p.id); connectionLabel.current?.focus(); } }}><Link2 size={13} /></button>
        {p.kind === 'image' && p.url && <img src={assetUrl(p.url)} alt={p.title} draggable={false} />}
        {p.body && <p>{p.body}</p>}{p.kind === 'link' && p.url && <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a>}
      </article>)}
      {!session.pins.length && <p className="brainBoardEmpty">Pin the pieces here.<br />Connect them with a reason, then explore the connection with Niwa.</p>}
    </div></div>
    <form className="brainConnectPins" onSubmit={e => { e.preventDefault(); void attempt(async () => { await run('connect', { id: session.id, from, to, label }); setLabel(current => current === label ? '' : current); }); }}><Link2 size={16} />{(['from', 'to'] as const).map(side => <select key={side} aria-label={`Connect ${side} pin`} value={side === 'from' ? from : to} onChange={e => (side === 'from' ? setFrom : setTo)(e.target.value)}><option value="">{side === 'from' ? 'From pin' : 'To pin'}</option>{session.pins.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>)}<input ref={connectionLabel} aria-label="Connection meaning" placeholder="How are they connected?" value={label} maxLength={1000} onChange={e => setLabel(e.target.value)} /><button disabled={busy || !from || !to || from === to || !label.trim()}>Connect</button></form>
    {!!session.edges.length && <details className="brainConnections"><summary>{session.edges.length} connections</summary>{session.edges.map(edge => <p key={edge.id}>{session.pins.find(p => p.id === edge.from)?.title} → {session.pins.find(p => p.id === edge.to)?.title}: {edge.label}<button aria-label={`Remove connection ${edge.label}`} disabled={busy} onClick={() => void attempt(() => run('disconnect', { id: session.id, edgeId: edge.id }))}><Trash2 size={13} /></button></p>)}</details>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
