import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowRight, MessageCircle } from 'lucide-react';
import type { PreparedData, Prepared } from '../../lib/brainstorm';
import { SceneFrame } from './SceneFrame';
import { SourceRoots } from './SourceRoots';
import { PastPages } from './PastPages';
import type { SceneProps } from './modules';

const START = 4, LAST = 60, END = 74;

function Timeline({ prepared, open }: { prepared: Prepared<'story'>; open: (index: number) => Promise<void> }) {
  const { chapters, patterns, continuations }: PreparedData['story'] = prepared.data;
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [prepared.generatedAt]);
  const x = (index: number) => START + (chapters.length === 1 ? 0 : index / (chapters.length - 1)) * (LAST - START);
  const lit = step >= chapters.length ? END : x(step), forked = step > chapters.length;
  const chapter = chapters[step];
  return <div className="story">
    <div className="timeline">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path className="artLine" pathLength={1} vectorEffect="non-scaling-stroke" d={`M0 20 H${END}`} />
        <path className="timelineLit" vectorEffect="non-scaling-stroke" d={`M0 20 H${lit}`} />
        {forked && [4, 20, 36].map((y, i) => <path key={y} className="artLine artFuture" pathLength={1} vectorEffect="non-scaling-stroke" style={{ '--d': `${i * 140}ms` } as CSSProperties} d={`M${END} 20 C${END + 10} 20 ${END + 12} ${y} 100 ${y}`} />)}
      </svg>
      {chapters.map((item, index) => <button key={index} className="bead" style={{ left: `${x(index)}%`, '--d': `${index * 160}ms` } as CSSProperties} data-reached={index <= step} aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}>
        <span className="beadDot" aria-hidden="true" /><small dir="auto">{item.when}</small>
      </button>)}
      <button className="bead beadFork" style={{ left: `${END}%` } as CSSProperties} data-reached={step >= chapters.length} aria-current={step >= chapters.length ? 'step' : undefined} onClick={() => setStep(chapters.length)}><span className="beadDot" aria-hidden="true" /><small>Now</small></button>
    </div>
    {chapter && <article className="storyPanel" key={step}>
      <h3 className="voiceTitle" dir="auto">{chapter.title}</h3>
      <p className="voice" dir="auto">{chapter.body}</p>
      <SourceRoots ids={chapter.sources} labels={prepared.sources} drawn={false} />
      <button className="nextBeat" onClick={() => setStep(step + 1)}><ArrowRight size={14} />{step + 1 < chapters.length ? chapters[step + 1].title : 'What connects these chapters'}</button>
    </article>}
    {step === chapters.length && <article className="storyPanel" key="patterns">
      <h3 className="voiceTitle">What connects these chapters</h3>
      <ul className="patterns">{patterns.map((pattern, i) => <li key={i}><strong dir="auto">{pattern.title}</strong><p className="voice" dir="auto">{pattern.body}</p></li>)}</ul>
      <button className="nextBeat" onClick={() => setStep(step + 1)}><ArrowRight size={14} />Where the story could go</button>
    </article>}
    {forked && <div className="continuations" key="continuations">{continuations.map((next, index) => <article key={index} style={{ '--i': index } as CSSProperties}>
      <h3 className="voiceTitle" dir="auto">{next.title}</h3><p className="voice" dir="auto">{next.body}</p><p className="question" dir="auto">{next.question}</p>
      <button className="primaryButton" onClick={() => void open(index).catch(() => {})}><MessageCircle size={15} />Continue with Niwa</button>
    </article>)}</div>}
  </div>;
}

export function StoryScene({ state, open, openSession, prepare, connect }: SceneProps) {
  return <SceneFrame mode="story" state={state} prepare={prepare} connect={connect} aside={<PastPages sessions={state.sessions.filter(s => s.mode === 'story')} open={openSession} />}>
    {prepared => <Timeline prepared={prepared} open={open} />}
  </SceneFrame>;
}
