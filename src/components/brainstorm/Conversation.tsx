import { useEffect, useRef } from 'react';
import { Pin } from 'lucide-react';
import type { BrainstormAction, BrainstormSession } from '../../lib/brainstorm';
import { MarkdownContent } from '../MarkdownContent';

interface ConversationProps { session: BrainstormSession; run: BrainstormAction; answering: boolean; pending: string; failed: boolean; retry: () => void; pin: (content: string) => void }

export function Thinking() {
  return <svg className="thinking" viewBox="0 0 60 16" role="img" aria-label="Niwa is thinking"><path pathLength={1} d="M2 8 C10 2 14 14 22 8 S34 2 42 8 S54 14 58 8" /></svg>;
}

export function Conversation({ session, run, answering, pending, failed, retry, pin }: ConversationProps) {
  const tail = useRef<HTMLDivElement>(null), opened = useRef(false);
  // A board page opens on the board itself; conversations open on their latest turn.
  useEffect(() => {
    if (opened.current || session.mode !== 'board') tail.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    opened.current = true;
  }, [session.messages.length, answering, session.mode]);
  return <div className="conversation">
    <header className="conversationSeed">
      <h1 className="voiceTitle" dir="auto">{session.title}</h1>
      {session.seed && <div className="voice"><MarkdownContent content={session.seed} /></div>}
      {session.mode === 'challenges' && <label className="checkInToggle"><input type="checkbox" checked={session.reminder} onChange={event => void run('reminder', { id: session.id, enabled: event.target.checked }).catch(() => {})} />
        {session.reminder ? session.nextCheckIn <= Date.now() ? 'Check in today: tell Niwa what moved forward.' : `Niwa will ask how it went on ${new Date(session.nextCheckIn).toLocaleDateString()}.` : 'Ask me how it went tomorrow'}</label>}
    </header>
    {session.messages.map(message => <article key={message.id} className={`turn ${message.role}`}>
      {message.role === 'user' ? <p dir="auto">{message.content}</p> : <div className="voice"><MarkdownContent content={message.content} /></div>}
      {message.role !== 'user' && <button className="quietButton pinTurn" onClick={() => pin(message.content)}><Pin size={12} />Pin to a board</button>}
    </article>)}
    {pending && (answering || failed) && <article className="turn user isPending"><p dir="auto">{pending}</p>{failed && !answering && <button className="quietButton retryTurn" onClick={retry}>Send again</button>}</article>}
    {answering && <article className="turn assistant"><Thinking /></article>}
    <div ref={tail} />
  </div>;
}
