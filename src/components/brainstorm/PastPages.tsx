import type { BrainstormSession } from '../../lib/brainstorm';

interface PastPagesProps { sessions: BrainstormSession[]; open: (id: string) => void; title?: string }

export function PastPages({ sessions, open, title = 'Pick up where you left off' }: PastPagesProps) {
  if (!sessions.length) return null;
  return <nav className="pastPages" aria-label={title}><h2>{title}</h2>
    {sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map(session => <button key={session.id} onClick={() => open(session.id)}>
      <strong dir="auto">{session.title}</strong><time>{new Date(session.updatedAt).toLocaleDateString()}</time>
    </button>)}
  </nav>;
}
