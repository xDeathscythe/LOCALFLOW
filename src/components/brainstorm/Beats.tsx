import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';

export interface Beat { title: string; content: ReactNode }

// A guided sequence: each beat is revealed by naming the next one, so the user always knows where the story goes.
export function Beats({ beats, finale, resetKey }: { beats: Beat[]; finale: ReactNode; resetKey: string | number }) {
  const [shown, setShown] = useState(1);
  const last = useRef<HTMLLIElement>(null);
  useEffect(() => setShown(1), [resetKey]);
  useEffect(() => { if (shown > 1) last.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [shown]);
  return <ol className="beats">
    {beats.slice(0, shown).map((beat, index) => <li key={`${resetKey}:${index}`} className="beat" ref={index === shown - 1 ? last : undefined} aria-current={index === shown - 1 ? 'step' : undefined}>
      <span className="beatMark" aria-hidden="true" /><h2>{beat.title}</h2><div className="beatBody">{beat.content}</div>
    </li>)}
    <li className="beat beatNext"><span className="beatMark" aria-hidden="true" />
      {shown < beats.length ? <button className="nextBeat" onClick={() => setShown(shown + 1)}><ArrowDown size={14} />{beats[shown].title}</button> : finale}
    </li>
  </ol>;
}
