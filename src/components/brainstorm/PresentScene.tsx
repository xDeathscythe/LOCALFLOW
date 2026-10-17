import { MessageCircle } from 'lucide-react';
import { MarkdownContent } from '../MarkdownContent';
import { SceneFrame } from './SceneFrame';
import { Beats } from './Beats';
import { SourceRoots } from './SourceRoots';
import { PastPages } from './PastPages';
import type { SceneProps } from './modules';

export function PresentScene({ state, open, openSession, prepare, connect }: SceneProps) {
  return <SceneFrame mode="present" state={state} prepare={prepare} connect={connect} aside={<PastPages sessions={state.sessions.filter(s => s.mode === 'present')} open={openSession} />}>
    {prepared => <Beats resetKey={prepared.generatedAt} beats={[
      { title: 'The thought', content: <div className="voice"><h3 className="voiceTitle" dir="auto">{prepared.data.idea.title}</h3><MarkdownContent content={prepared.data.idea.body} /></div> },
      { title: 'Where it came from', content: <><p className="voice" dir="auto">{prepared.data.origin}</p><SourceRoots ids={prepared.data.idea.sources} labels={prepared.sources} /></> },
      { title: 'Why it matters now', content: <p className="voice" dir="auto">{prepared.data.whyNow}</p> },
    ]} finale={<button className="primaryButton" onClick={() => void open(0).catch(() => {})}><MessageCircle size={15} />Talk it through with Niwa</button>} />}
  </SceneFrame>;
}
