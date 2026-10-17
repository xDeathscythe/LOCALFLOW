import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, FilePlus2, Pin } from 'lucide-react';
import { memo, useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';

let highlighter: Promise<typeof import('rehype-highlight')> | undefined;

function CodeBlock({ children }: { children?: ReactNode }) {
  return <div className="messageCode"><button aria-label="Copy code" title="Copy code" onClick={event => { const code = event.currentTarget.parentElement?.querySelector('pre')?.textContent || ''; void window.localflow.copyText(code); }}><Copy size={13} /></button><pre>{children}</pre></div>;
}
export const MarkdownContent = memo(function MarkdownContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const deferred = useDeferredValue(content);
  const body = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<typeof import('rehype-highlight')['default']>();
  useEffect(() => {
    if (streaming || highlight || !body.current?.querySelector('pre')) return;
    let live = true;
    highlighter ??= import('rehype-highlight');
    void highlighter.then(module => { if (live) setHighlight(() => module.default); }).catch(() => { highlighter = undefined; });
    return () => { live = false; };
  }, [streaming, deferred, highlight]);
  return <div className="markdownBody" ref={body}><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={!streaming && highlight ? [highlight] : []} components={{ pre: CodeBlock, a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ src, alt }) => <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noreferrer">{alt || 'Image'}</a> }}>{deferred}</Markdown></div>;
});
export function MessageActions({ content }: { content: string }) {
  const [status, setStatus] = useState('');
  const save = async () => {
    try { await window.localflow.notesCreate({ label: `Niwa · ${new Date().toLocaleString()}`, content }); setStatus('Saved to Notes'); }
    catch (error) { setStatus(String(error)); }
  };
  const pin = async () => {
    try {
      let state = await window.localflow.brainstormCall('load');
      let board = state.sessions.slice().reverse().find(s => s.mode === 'board');
      if (!board) { state = await window.localflow.brainstormCall('create', { mode: 'board', title: 'Idea board' }); board = state.sessions.at(-1)!; }
      await window.localflow.brainstormCall('pin', { id: board.id, pin: { id: crypto.randomUUID(), kind: 'message', title: 'Niwa message', body: content.slice(0, 30000), x: 40 + board.pins.length % 4 * 250, y: 40 + Math.floor(board.pins.length / 4) * 230 } });
      setStatus('Pinned to Idea board');
    } catch (error) { setStatus(String(error)); }
  };
  return <div className="messageActions"><button aria-label="Copy message" title="Copy message" onClick={() => void window.localflow.copyText(content)}><Copy size={13} /></button><button aria-label="Save to Notes" title="Save to Notes" onClick={() => void save()}><FilePlus2 size={13} /></button><button aria-label="Pin to Idea board" title="Pin to Idea board" onClick={() => void pin()}><Pin size={13} /></button><span role="status">{status}</span></div>;
}
