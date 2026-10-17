import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, FileText, MessageCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import { MarkdownContent } from '../MarkdownContent';
import { SceneFrame } from './SceneFrame';
import { SourceRoots } from './SourceRoots';
import { PastPages } from './PastPages';
import type { SceneProps } from './modules';

export function ThoughtsScene({ state, run, open, openSession, prepare, connect, notify }: SceneProps & { notify: (text: string) => void }) {
  const [index, setIndex] = useState(0);
  const generatedAt = state.prepared.thoughts?.generatedAt;
  useEffect(() => setIndex(0), [generatedAt]);
  return <SceneFrame mode="thoughts" state={state} prepare={prepare} connect={connect} aside={<PastPages sessions={state.sessions.filter(s => s.mode === 'thoughts')} open={openSession} />}>
    {prepared => {
      const thoughts = prepared.data.thoughts, thought = thoughts[index];
      const id = `${prepared.generatedAt}:${index}`, rating = state.feedback.find(f => f.id === id)?.rating;
      const rate = (value: 1 | -1) => void run('feedback', { id, title: thought.title, body: thought.body, rating: value }).catch(() => {});
      return <div className="thoughts">
        <div className="stones" role="tablist" aria-label="Thoughts">{thoughts.map((item, i) => <button key={i} role="tab" aria-selected={i === index} aria-label={item.title} className="stone" style={{ '--i': i } as CSSProperties} onClick={() => setIndex(i)}><span /></button>)}</div>
        <article className="thought" key={id} role="tabpanel">
          <h3 className="voiceTitle" dir="auto">{thought.title}</h3>
          <div className="voice"><MarkdownContent content={thought.body} /></div>
          <SourceRoots ids={thought.sources} labels={prepared.sources} drawn={false} />
          <footer>
            <button className="primaryButton" onClick={() => void open(index).catch(() => {})}><MessageCircle size={15} />Talk about this</button>
            <span className="rating" role="group" aria-label="Tell Niwa if this landed">
              <button className="iconButton" aria-label={`Like thought ${index + 1}`} aria-pressed={rating === 1} onClick={() => rate(1)}><ThumbsUp size={15} /></button>
              <button className="iconButton" aria-label={`Dislike thought ${index + 1}`} aria-pressed={rating === -1} onClick={() => rate(-1)}><ThumbsDown size={15} /></button>
              <button className="iconButton" aria-label={`Save thought ${index + 1} to Notes`} onClick={() => void window.localflow.notesCreate({ label: thought.title, content: thought.body }).then(() => notify('Thought saved to Notes.'), error => notify(String(error)))}><FileText size={15} /></button>
            </span>
            <span className="pager">
              <button className="iconButton" aria-label="Previous thought" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={16} /></button>
              <button className="iconButton" aria-label="Next thought" disabled={index === thoughts.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={16} /></button>
            </span>
          </footer>
        </article>
      </div>;
    }}
  </SceneFrame>;
}
