import { useEffect, useMemo, useState } from 'react';
import { FileDiff, X } from 'lucide-react';
import { parseDiff } from '../lib/diff';
import { PanelResize } from './PanelResize';
import { DiffFile } from './DiffFile';

export function AgentDiff({ diff, focusedFile, onClose }: { diff: string; focusedFile?: string; onClose: () => void }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [split, setSplit] = useState(false);
  const [filter, setFilter] = useState('');
  useEffect(() => { setFilter(focusedFile || ''); }, [focusedFile, diff]);
  return <aside className="agentDiff" aria-label="Agent changes">
    <PanelResize label="Resize changes" property="--diff-width" edge="left" min={260} max={960} fraction={0.6} />
    <header><FileDiff size={14} /><strong>{files.length ? `${files.length} files changed` : 'Changes'}</strong><button title="Toggle split diff" aria-label="Toggle split diff" aria-pressed={split} onClick={() => setSplit(!split)}>{split ? 'Unified' : 'Split'}</button><button onClick={onClose} aria-label="Close changes" title="Close changes"><X size={14} /></button></header>
    {files.length > 1 && <input className="diffFilter" aria-label="Filter changed files" placeholder="Find file…" value={filter} onChange={event => setFilter(event.target.value)} />}
    {files.length ? <div className="agentDiffFiles">{files.filter(file => file.path.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map((file, index) => <DiffFile key={`${file.path}-${focusedFile || ''}`} file={file} split={split} initiallyOpen={index === 0 || file.path === focusedFile} />)}</div> : <div className="agentDiffEmpty"><FileDiff size={26} /><span>No changes yet</span></div>}
  </aside>;
}
