import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { GitBranch, Plus, Sprout } from 'lucide-react';
import type { BrainstormAction, BrainstormSession, PathNode } from '../../lib/brainstorm';

const COLUMN = 290, SLOT = 92, WIDTH = 230, HEIGHT = 74, PAD = 28;

// Leaves take consecutive rows and each parent sits between its first and last child, so branches never cross.
function layout(nodes: PathNode[]) {
  const children = new Map<string, PathNode[]>();
  nodes.forEach(node => children.set(node.parentId, [...(children.get(node.parentId) || []), node]));
  const order: { node: PathNode; depth: number }[] = [];
  const stack = (children.get('') || []).slice().reverse().map(node => ({ node, depth: 0 }));
  while (stack.length) {
    const entry = stack.pop()!; order.push(entry);
    (children.get(entry.node.id) || []).slice().reverse().forEach(node => stack.push({ node, depth: entry.depth + 1 }));
  }
  const at = new Map<string, { x: number; y: number }>();
  let row = 0;
  order.forEach(({ node, depth }) => { if (!children.get(node.id)?.length) at.set(node.id, { x: PAD + depth * COLUMN, y: PAD + row++ * SLOT }); });
  order.slice().reverse().forEach(({ node, depth }) => {
    const kids = children.get(node.id);
    if (kids?.length) at.set(node.id, { x: PAD + depth * COLUMN, y: (at.get(kids[0].id)!.y + at.get(kids.at(-1)!.id)!.y) / 2 });
  });
  const depth = Math.max(0, ...order.map(entry => entry.depth));
  return { at, children, width: PAD * 2 + depth * COLUMN + WIDTH, height: Math.max(PAD * 2 + HEIGHT, PAD * 2 + (row - 1) * SLOT + HEIGHT) };
}

interface PathsProps { session: BrainstormSession; run: BrainstormAction; growing: string[] }

export function Paths({ session, run, growing }: PathsProps) {
  const { at, children, width, height } = useMemo(() => layout(session.nodes), [session.nodes]);
  const selected = session.nodes.find(n => n.id === session.selectedId);
  const [draft, setDraft] = useState(''), [body, setBody] = useState(selected?.body || ''), [saved, setSaved] = useState(selected?.body || '');
  const dirty = body !== saved;
  const graph = useRef<HTMLDivElement>(null);
  const trail = useMemo(() => {
    const ids: string[] = [];
    for (let node = selected; node; node = session.nodes.find(n => n.id === node!.parentId)) ids.unshift(node.id);
    return ids;
  }, [selected, session.nodes]);
  const onTrail = new Set(trail), isGrowing = Boolean(selected && growing.includes(selected.id));
  const hasDirections = Boolean(selected && children.get(selected.id)?.some(n => n.suggested));
  useEffect(() => { setBody(selected?.body || ''); setSaved(selected?.body || ''); }, [selected?.id]);
  useEffect(() => { graph.current?.querySelector(`[data-node="${session.selectedId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); }, [session.selectedId, session.nodes.length]);
  const grow = (node: PathNode) => run('expand', { id: session.id, nodeId: node.id });
  const select = async (node: PathNode) => {
    if (dirty && selected && body.trim()) await run('write', { id: session.id, nodeId: selected.id, body });
    await run('select', { id: session.id, nodeId: node.id });
    // Choosing a direction is the signal to prepare its next five, so they are usually ready on arrival.
    if (!children.get(node.id)?.length) void grow(node).catch(() => {});
  };
  return <div className="paths">
    <ol className="pathTrail" aria-label="Your path">{trail.map(id => { const node = session.nodes.find(n => n.id === id)!; return <li key={id}><button onClick={() => void select(node).catch(() => {})} aria-current={id === session.selectedId ? 'step' : undefined} dir="auto">{node.title}</button></li>; })}</ol>
    <div className="pathGraph" ref={graph} aria-label="Branching map"><div style={{ width, height }}>
      <svg width={width} height={height} aria-hidden="true">{session.nodes.filter(n => n.parentId && at.has(n.parentId)).map(node => {
        const a = at.get(node.parentId)!, b = at.get(node.id)!, y1 = a.y + HEIGHT / 2, y2 = b.y + HEIGHT / 2;
        return <path key={node.id} pathLength={1} className={`artLine pathEdge ${onTrail.has(node.id) ? 'onTrail' : ''}`} d={`M${a.x + WIDTH},${y1} C${a.x + WIDTH + 40},${y1} ${b.x - 40},${y2} ${b.x},${y2}`} />;
      })}</svg>
      {session.nodes.map(node => {
        const point = at.get(node.id); if (!point) return null;
        const siblings = children.get(node.parentId) || [];
        return <button key={node.id} data-node={node.id} className={`pathNode ${node.parentId && !node.suggested ? 'isOwn' : ''}`} data-trail={onTrail.has(node.id)} aria-pressed={node.id === session.selectedId}
          style={{ left: point.x, top: point.y, '--i': siblings.indexOf(node) } as CSSProperties} onClick={() => void select(node).catch(() => {})}>
          <strong dir="auto">{node.title}</strong><span dir="auto">{node.body}</span>
          {node.id === session.selectedId && isGrowing && <i className="sprouts" aria-hidden="true"><b /><b /><b /></i>}
        </button>;
      })}
    </div></div>
    {selected && <aside className="pathPanel" key={selected.id}>
      <h2 className="voiceTitle" dir="auto">{selected.title}</h2>
      <label><span>Write this part of the story</span><textarea aria-label="Path narrative" value={body} dir="auto" onChange={event => setBody(event.target.value)} onBlur={() => { const text = body; if (dirty && text.trim()) void run('write', { id: session.id, nodeId: selected.id, body: text }).then(() => setSaved(text)).catch(() => {}); }} /></label>
      {isGrowing ? <p className="growing" aria-live="polite"><Sprout size={15} />Niwa is growing five directions from here…</p>
        : !hasDirections && <button className="primaryButton" onClick={() => void grow(selected).catch(() => {})}><GitBranch size={15} />Show five directions</button>}
      <form onSubmit={event => { event.preventDefault(); if (draft.trim()) void run('branch', { id: session.id, parentId: selected.id, title: Array.from(draft).slice(0, 100).join(''), body: draft }).then(() => setDraft('')).catch(() => {}); }}>
        <input aria-label="Your own direction" placeholder="Take it somewhere of your own…" value={draft} maxLength={16000} onChange={event => setDraft(event.target.value)} />
        <button className="quietButton" aria-label="Add branch" disabled={!draft.trim()}><Plus size={15} />Add</button>
      </form>
    </aside>}
  </div>;
}
