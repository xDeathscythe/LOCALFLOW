import { useRef, useState } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import type { BrainstormAction, BrainstormSession, PathNode } from '../../lib/brainstorm';

export function Paths({ session, run, busy }: { session: BrainstormSession; run: BrainstormAction; busy: boolean }) {
  const selected = session.nodes.find(n => n.id === session.selectedId);
  const [draft, setDraft] = useState('');
  const [body, setBody] = useState(selected?.body || '');
  const [editing, setEditing] = useState(false);
  const direction = useRef<HTMLInputElement>(null);
  const positions = new Map<string, { x: number; y: number }>();
  const rows: number[] = [];
  // Parents are persisted before children; a linear pass lays out every branch.
  const depths = new Map<string, number>();
  session.nodes.forEach(node => {
    const depth = node.parentId ? (depths.get(node.parentId) || 0) + 1 : 0;
    depths.set(node.id, depth);
    const row = rows[depth] || 0; rows[depth] = row + 1;
    positions.set(node.id, { x: 32 + depth * 260, y: 30 + row * 112 });
  });
  const blankDepth = selected ? (depths.get(selected.id) || 0) + 1 : 0;
  const blank = { x: 32 + blankDepth * 260, y: 30 + (rows[blankDepth] || 0) * 112 };
  const width = Math.max(780, rows.length * 260 + 32, selected ? blank.x + 250 : 0), height = Math.max(260, Math.max(0, ...rows) * 112 + 30, selected ? blank.y + 112 : 0);
  const select = async (node: PathNode) => { if (editing) await run('write', { id: session.id, nodeId: session.selectedId, body }); await run('select', { id: session.id, nodeId: node.id }); setBody(node.body); setEditing(false); };
  return <div className="brainPaths">
    <div className="brainGraph" aria-label="Branching story map"><div style={{ width, height }}>
      <svg width={width} height={height} aria-hidden="true">{session.nodes.filter(n => n.parentId).map(node => {
        const a = positions.get(node.parentId)!, b = positions.get(node.id)!;
        return <path key={node.id} d={`M${a.x + 216},${a.y + 36} C${a.x + 240},${a.y + 36} ${b.x - 24},${b.y + 36} ${b.x},${b.y + 36}`} />;
      })}{selected && <path strokeDasharray="4 5" d={`M${positions.get(selected.id)!.x + 216},${positions.get(selected.id)!.y + 36} L${blank.x},${blank.y + 36}`} />}</svg>
      {session.nodes.map(node => <button key={node.id} className="brainPathNode" aria-pressed={node.id === selected?.id} disabled={busy} style={{ left: positions.get(node.id)!.x, top: positions.get(node.id)!.y }} onClick={() => void select(node).catch(() => {})}><GitBranch size={15} /><strong>{node.title}</strong><span>{node.body}</span></button>)}
      {selected && <button className="brainBlankNode" disabled={busy} style={{ left: blank.x, top: blank.y }} onClick={() => direction.current?.focus()}><Plus size={18} />Your own direction</button>}
      {!session.nodes.length && <p className="brainGraphEmpty">Write an idea below to start a path.</p>}
    </div></div>
    {selected && <div className="brainPathEditor" key={selected.id}>
      <header><h3>{selected.title}</h3><button disabled={busy || session.nodes.some(n => n.parentId === selected.id && n.suggested)} onClick={() => void run('expand', { id: session.id, nodeId: selected.id }).catch(() => {})}><GitBranch size={15} />Explore five directions</button></header>
      <label>Write this part of the story<textarea aria-label="Path narrative" defaultValue={selected.body} disabled={busy} onChange={e => { setBody(e.target.value); setEditing(true); }} onBlur={() => { if (editing && body.trim()) void run('write', { id: session.id, nodeId: selected.id, body }).then(() => setEditing(false)).catch(() => {}); }} /></label>
      <form onSubmit={e => { e.preventDefault(); if (draft.trim()) void run('branch', { id: session.id, parentId: selected.id, title: Array.from(draft).slice(0, 100).join(''), body: draft }).then(() => { setDraft(current => current === draft ? '' : current); setEditing(false); }).catch(() => {}); }}>
        <Plus size={16} /><input ref={direction} aria-label="Your own direction" placeholder="Take this in a direction of your own…" value={draft} onChange={e => setDraft(e.target.value)} maxLength={16000} /><button disabled={busy || !draft.trim()}>Add branch</button>
      </form>
    </div>}
  </div>;
}
