import type { CSSProperties } from 'react';
import { GitBranch } from 'lucide-react';
import { SceneFrame } from './SceneFrame';
import { PastPages } from './PastPages';
import type { SceneProps } from './modules';

const tips = [12, 30, 48, 66, 84];

export function PathsScene({ state, open, openSession, prepare, connect }: SceneProps) {
  return <SceneFrame mode="paths" state={state} prepare={prepare} connect={connect} aside={<PastPages sessions={state.sessions.filter(s => s.mode === 'paths')} open={openSession} />}>
    {prepared => <div className="seeds">{prepared.data.seeds.map((seed, index) => <article key={`${prepared.generatedAt}:${index}`} className="seed" style={{ '--i': index } as CSSProperties}>
      <svg viewBox="0 0 120 96" aria-hidden="true">
        <path className="artLine" pathLength={1} d="M4 48 C30 48 36 48 52 48" style={{ '--d': `${index * 160}ms` } as CSSProperties} />
        {tips.map((y, i) => <path key={y} className="artLine" pathLength={1} d={`M52 48 C76 48 80 ${y} 112 ${y}`} style={{ '--d': `${index * 160 + 300 + i * 70}ms` } as CSSProperties} />)}
        <circle className="artLantern" cx={52} cy={48} r={3.4} style={{ '--d': `${index * 160 + 250}ms` } as CSSProperties} />
        {tips.map((y, i) => <circle key={y} className="artDot" cx={112} cy={y} r={2.4} style={{ '--d': `${index * 160 + 600 + i * 70}ms` } as CSSProperties} />)}
      </svg>
      <h3 className="voiceTitle" dir="auto">{seed.title}</h3>
      <p className="voice seedBody" dir="auto">{seed.body}</p>
      <ul className="seedBranches">{seed.branches.map((branch, i) => <li key={i} dir="auto">{branch.title}</li>)}</ul>
      <button className="primaryButton" onClick={() => void open(index).catch(() => {})}><GitBranch size={15} />Follow this idea</button>
    </article>)}</div>}
  </SceneFrame>;
}
