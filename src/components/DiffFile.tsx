import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { splitRows, type parseDiff } from '../lib/diff';

const lineHeight = 20, viewportHeight = 480, overscan = 8;
export function DiffFile({ file, split, initiallyOpen }: { file: ReturnType<typeof parseDiff>[number]; split: boolean; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [scrollTop, setScrollTop] = useState(0);
  const [search, setSearch] = useState(''), [matchIndex, setMatchIndex] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const pairs = useMemo(() => open && split ? splitRows(file.rows) : [], [file.rows, open, split]);
  const count = split ? pairs.length : file.rows.length;
  const virtual = count > 300;
  const matches = useMemo(() => {
    const needle = search.toLocaleLowerCase();
    if (!open || !needle) return [];
    return (split ? pairs.map(row => `${row.left?.text || ''}\n${row.right?.text || ''}`) : file.rows.map(row => row.text))
      .flatMap((text, index) => text.toLocaleLowerCase().includes(needle) ? [index] : []);
  }, [file.rows, pairs, search, split, open]);
  useEffect(() => { setMatchIndex(0); }, [search, split]);
  useEffect(() => {
    if (matches.length && viewport.current) viewport.current.scrollTop = matches[matchIndex % matches.length] * lineHeight;
  }, [matches, matchIndex]);
  const start = virtual ? Math.max(0, Math.min(count - 1, Math.floor(scrollTop / lineHeight)) - overscan) : 0;
  const end = virtual ? Math.min(count, start + Math.ceil(viewportHeight / lineHeight) + overscan * 2) : count;
  const width = useMemo(() => open ? file.rows.reduce((max, row) => Math.max(max, row.text.length), 1) : 1, [file.rows, open]);
  return <details className="diffFile" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong title={file.path}>{file.path}</strong><span className="diffAdded">+{file.added}</span><span className="diffRemoved">−{file.removed}</span><button title="Copy patch" aria-label={`Copy patch for ${file.path}`} onClick={event => { event.preventDefault(); void window.localflow.copyText(file.patch); }}><Copy size={12} /></button></summary>
    {open && <>
      {virtual && <div className="diffSearch"><input aria-label={`Find in ${file.path}`} placeholder="Find in patch…" value={search} onChange={event => setSearch(event.target.value)} /><span>{matches.length ? `${matchIndex % matches.length + 1}/${matches.length}` : search ? '0 results' : `${count} lines`}</span><button aria-label="Previous match" disabled={!matches.length} onClick={() => setMatchIndex(index => (index + matches.length - 1) % matches.length)}>↑</button><button aria-label="Next match" disabled={!matches.length} onClick={() => setMatchIndex(index => (index + 1) % matches.length)}>↓</button></div>}
      <div ref={viewport} className={`diffCode ${split ? 'split' : ''}`} style={virtual ? { maxHeight: viewportHeight, padding: 0 } : undefined} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} tabIndex={0} role="region" aria-label={`Code diff: ${file.path}`}>
        {!file.rows.length ? <pre>{file.patch}</pre> : <div style={{ paddingTop: start * lineHeight, paddingBottom: (count - end) * lineHeight, minWidth: `calc(${width * (split ? 2 : 1)}ch + ${split ? 110 : 100}px)` }}>
          {split ? pairs.slice(start, end).map((row, index) => <div className="diffPair" key={start + index} style={{ height: lineHeight, lineHeight: `${lineHeight}px` }}>{(['left', 'right'] as const).map(side => <div className="diffLine" data-prefix={row[side]?.kind} key={side}><span className="lineNumber">{side === 'left' ? row[side]?.old : row[side]?.next}</span><code>{row[side]?.text || ' '}</code></div>)}</div>) : file.rows.slice(start, end).map((row, index) => <div className="diffLine" key={start + index} data-prefix={row.kind} style={{ height: lineHeight, lineHeight: `${lineHeight}px` }}><span className="lineNumber">{row.old}</span><span className="lineNumber">{row.next}</span><span className="diffMarker">{row.kind === '+' || row.kind === '-' ? row.kind : ''}</span><code>{row.text || ' '}</code></div>)}
        </div>}
      </div>
    </>}
  </details>;
}
