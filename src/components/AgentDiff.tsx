import { useEffect, useMemo, useState } from 'react';
import { FileDiff, X, Copy } from 'lucide-react';
import { parseDiff, splitRows } from '../lib/diff';
import { PanelResize } from './PanelResize';

export function AgentDiff({ diff, focusedFile, onClose }: { diff: string; focusedFile?: string; onClose: () => void }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [split, setSplit] = useState(false);
  const [filter, setFilter] = useState('');
  useEffect(() => { setFilter(focusedFile || ''); }, [focusedFile, diff]);
  return <aside className="agentDiff" aria-label="Agent changes">
    <PanelResize label="Resize changes" property="--diff-width" edge="left" min={260} max={960} fraction={0.6} />
    <header><FileDiff size={14} /><strong>{files.length ? `${files.length} files changed` : 'Changes'}</strong><button title="Toggle split diff" aria-label="Toggle split diff" aria-pressed={split} onClick={() => setSplit(!split)}>{split ? 'Unified' : 'Split'}</button><button onClick={onClose} aria-label="Close changes" title="Close changes"><X size={14} /></button></header>
    {files.length > 1 && <input className="diffFilter" aria-label="Filter changed files" placeholder="Find file…" value={filter} onChange={event => setFilter(event.target.value)} />}
    {files.length ? <div className="agentDiffFiles">{files.filter(file => file.path.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map((file, index) => <details className="diffFile" open key={`${file.path}-${index}`}>
      <summary><strong title={file.path}>{file.path}</strong><span className="diffAdded">+{file.added}</span><span className="diffRemoved">−{file.removed}</span><button title="Copy patch" aria-label={`Copy patch for ${file.path}`} onClick={event => { event.preventDefault(); void window.localflow.copyText(file.patch); }}><Copy size={12} /></button></summary>
      <div className={`diffCode ${split ? 'split' : ''}`} tabIndex={0} role="region" aria-label={`Code diff: ${file.path}`}>
        {!file.rows.length ? <pre>{file.patch}</pre> : split ? splitRows(file.rows).map((row, index) => <div className="diffPair" key={index}>{(['left', 'right'] as const).map(side => <div className="diffLine" data-prefix={row[side]?.kind} key={side}><span className="lineNumber">{side === 'left' ? row[side]?.old : row[side]?.next}</span><code>{row[side]?.text || ' '}</code></div>)}</div>) : file.rows.map((row, index) => <div className="diffLine" key={index} data-prefix={row.kind}><span className="lineNumber">{row.old}</span><span className="lineNumber">{row.next}</span><span className="diffMarker">{row.kind === '+' || row.kind === '-' ? row.kind : ''}</span><code>{row.text || ' '}</code></div>)}
      </div>
    </details>)}</div> : <div className="agentDiffEmpty"><FileDiff size={26} /><span>No changes yet</span></div>}
  </aside>;
}
