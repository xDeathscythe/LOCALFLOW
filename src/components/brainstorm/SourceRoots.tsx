import type { CSSProperties } from 'react';
import { FileText, MessageCircle, Sparkles, Bookmark } from 'lucide-react';
import type { SourceLabel } from '../../lib/brainstorm';

const icons = { note: FileText, chat: MessageCircle, brainstorm: Sparkles, memory: Bookmark, feedback: Sparkles };
const kinds = { note: 'Note', chat: 'Conversation', brainstorm: 'Brainstorm page', memory: 'Something Niwa remembers', feedback: 'Your feedback' };

interface SourceRootsProps { ids: string[]; labels: Record<string, SourceLabel>; drawn?: boolean }

// Lines run from the idea down to each cited source, so the origin reads as roots rather than a list.
export function SourceRoots({ ids, labels, drawn = true }: SourceRootsProps) {
  const known = ids.filter(id => labels[id]);
  if (!known.length) return <p className="sourceNone">Niwa did not find a matching note or conversation for this one, so treat it as a fresh starting point.</p>;
  // Roots stay legible up to four sources; longer lists wrap as plain chips.
  const columns = known.length, lines = drawn && columns <= 4;
  return <div className={`sourceRoots ${lines ? 'hasRoots' : ''}`} style={{ '--n': columns } as CSSProperties}>
    {lines && <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">{known.map((id, i) => {
      const x = (i + .5) / columns * 100;
      return <path key={id} className="artLine" pathLength={1} vectorEffect="non-scaling-stroke" style={{ '--d': `${i * 120}ms` } as CSSProperties} d={`M50 0 C50 12 ${x} 10 ${x} 24`} />;
    })}</svg>}
    <ul>{known.map((id, i) => {
      const source = labels[id], Icon = icons[source.kind] || FileText;
      return <li key={id} style={{ '--d': `${300 + i * 120}ms` } as CSSProperties} title={kinds[source.kind]}><Icon size={13} aria-hidden="true" /><span dir="auto">{source.label}</span>{source.at ? <time>{new Date(source.at).toLocaleDateString()}</time> : null}</li>;
    })}</ul>
  </div>;
}
