import type { CSSProperties } from 'react';
import { Network, Plus } from 'lucide-react';
import { SceneFrame } from './SceneFrame';
import { PastPages } from './PastPages';
import type { SceneProps } from './modules';

const place = (index: number, count: number) => {
  const angle = index / count * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + Math.cos(angle) * 36, y: 50 + Math.sin(angle) * 38 };
};

export function BoardScene({ state, open, openSession, prepare, connect, createEmpty }: SceneProps & { createEmpty: () => Promise<void> }) {
  return <SceneFrame mode="board" state={state} prepare={prepare} connect={connect} aside={<PastPages title="Your boards" sessions={state.sessions.filter(s => s.mode === 'board')} open={openSession} />}>
    {prepared => {
      const { pins, links, question, title } = prepared.data;
      return <div className="constellation">
        <p className="constellationQuestion voice" dir="auto">{question}</p>
        <div className="constellationStage">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{links.map((link, i) => {
            const a = place(link.from, pins.length), b = place(link.to, pins.length);
            return <path key={i} className="artLine artThread" pathLength={1} vectorEffect="non-scaling-stroke" style={{ '--d': `${600 + i * 180}ms` } as CSSProperties} d={`M${a.x} ${a.y} Q50 50 ${b.x} ${b.y}`} />;
          })}</svg>
          {pins.map((pin, i) => { const at = place(i, pins.length); return <article key={i} className="starPin" style={{ left: `${at.x}%`, top: `${at.y}%`, '--d': `${i * 120}ms` } as CSSProperties}><strong dir="auto">{pin.title}</strong><p dir="auto">{pin.body}</p></article>; })}
          {links.map((link, i) => { const a = place(link.from, pins.length), b = place(link.to, pins.length); return <span key={i} className="threadLabel" style={{ left: `${(a.x + b.x) / 4 + 25}%`, top: `${(a.y + b.y) / 4 + 25}%`, '--d': `${900 + i * 180}ms` } as CSSProperties} dir="auto">{link.label}</span>; })}
        </div>
        <div className="sceneActions">
          <button className="primaryButton" onClick={() => void open(0).catch(() => {})}><Network size={15} />Open “{title}”</button>
          <button className="quietButton" onClick={() => void createEmpty().catch(() => {})}><Plus size={15} />Start an empty board</button>
        </div>
      </div>;
    }}
  </SceneFrame>;
}
