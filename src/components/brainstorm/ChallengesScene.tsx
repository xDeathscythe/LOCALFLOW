import { useState, type CSSProperties } from 'react';
import { Flag, Mountain, Footprints } from 'lucide-react';
import { SceneFrame } from './SceneFrame';
import { PastPages } from './PastPages';
import type { SceneProps } from './modules';

const wins = [[120, 170], [330, 130], [420, 140]], stones = [[200, 180], [262, 156], [470, 121]], markers = [[650, 80], [780, 60], [910, 30]];

export function ChallengesScene({ state, open, openSession, prepare, connect }: SceneProps) {
  const [focus, setFocus] = useState(0);
  const due = state.sessions.filter(s => s.mode === 'challenges' && s.reminder && s.nextCheckIn <= Date.now());
  return <SceneFrame mode="challenges" state={state} prepare={prepare} connect={connect} aside={<PastPages title="Challenges you are working on" sessions={state.sessions.filter(s => s.mode === 'challenges')} open={openSession} />}>
    {prepared => <div className="ascent">
      {due.map(session => <button key={session.id} className="checkIn" onClick={() => openSession(session.id)}><Footprints size={15} /><span dir="auto">How did “{session.title}” go? Tell Niwa what moved, or what did not.</span></button>)}
      <svg className="ridge" viewBox="0 0 1000 210" aria-hidden="true">
        <path className="artLine" pathLength={1} d="M0 200 L120 170 L200 180 L330 130 L420 140 L520 100" />
        <path className="artLine artFuture" pathLength={1} style={{ '--d': '700ms' } as CSSProperties} d="M520 100 L650 80 L780 60 L910 30 L1000 40" />
        {prepared.data.wins.map((_, i) => <path key={`w${i}`} className="artLine" pathLength={1} style={{ '--d': `${400 + i * 150}ms` } as CSSProperties} d={`M${wins[i][0]} ${wins[i][1]} v-26 l14 5 l-14 5`} />)}
        {prepared.data.struggles.map((_, i) => <circle key={`s${i}`} className="artDot" cx={stones[i][0]} cy={stones[i][1] - 4} r={4} style={{ '--d': `${500 + i * 150}ms` } as CSSProperties} />)}
        <circle className="artGlow" cx={520} cy={100} r={18} /><circle className="artLantern" cx={520} cy={100} r={5} style={{ '--d': '600ms' } as CSSProperties} />
        {prepared.data.suggestions.map((_, i) => <g key={`m${i}`} className="marker" data-focus={i === focus}><path className="artLine" pathLength={1} style={{ '--d': `${900 + i * 150}ms` } as CSSProperties} d={`M${markers[i][0]} ${markers[i][1]} v-30`} /><circle className="artDot" cx={markers[i][0]} cy={markers[i][1] - 32} r={4} style={{ '--d': `${1000 + i * 150}ms` } as CSSProperties} /></g>)}
      </svg>
      <div className="ascentColumns">
        <section aria-labelledby="behind"><h2 id="behind">Behind you</h2>
          {!prepared.data.wins.length && !prepared.data.struggles.length && <p className="voice">Niwa has not seen earlier challenges in your notes or conversations yet. Your first one starts the trail.</p>}
          <ul className="trailList">
            {prepared.data.wins.map((item, i) => <li key={`w${i}`}><Flag size={14} aria-label="Win" /><div><strong dir="auto">{item.title}</strong><p dir="auto">{item.body}</p></div></li>)}
            {prepared.data.struggles.map((item, i) => <li key={`s${i}`} className="isStone"><Mountain size={14} aria-label="Difficulty" /><div><strong dir="auto">{item.title}</strong><p dir="auto">{item.body}</p></div></li>)}
          </ul>
        </section>
        <section aria-labelledby="ahead"><h2 id="ahead">Where you could go next</h2>
          <div className="markers">{prepared.data.suggestions.map((item, index) => <article key={index} data-focus={index === focus} onMouseEnter={() => setFocus(index)} onFocus={() => setFocus(index)}>
            <h3 className="voiceTitle" dir="auto">{item.title}</h3>
            <p className="voice" dir="auto">{item.why}</p>
            <p className="firstStep" dir="auto"><Footprints size={14} aria-hidden="true" /><span><b>A first step today</b>{item.firstStep}</span></p>
            <button className="primaryButton" onClick={() => void open(index).catch(() => {})}>Take this on</button>
          </article>)}</div>
        </section>
      </div>
    </div>}
  </SceneFrame>;
}
