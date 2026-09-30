import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDiff, Undo2 } from 'lucide-react';
import { parseDiff } from '../lib/diff';
import type { AgentActivity } from '../lib/workspace';

export type ChatWork = { startedAt: number; completedAt?: number; activities: AgentActivity[]; diff: string };
export function WorkDetails({ work, busy }: { work: ChatWork; busy?: boolean }) {
  const seconds = Math.max(1, Math.round(((work.completedAt || Date.now()) - work.startedAt) / 1000));
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return <details className="chatWork"><summary>{busy ? 'Working' : `Worked for ${duration}`}<ChevronRight size={13} /></summary><div className="agentActivities">{work.activities.map(item => <details key={item.id} className="agentActivity"><summary><span className={`activityDot ${item.status}`} /><span>{item.title}</span><small>{item.status}</small></summary>{item.content && <pre>{item.content}</pre>}</details>)}{!work.activities.length && <p>{busy ? 'Thinking…' : 'Completed'}</p>}</div></details>;
}
export function ChangesCard({ diff, canUndo, onView, onUndo }: { diff: string; canUndo: boolean; onView: (file?: string) => void; onUndo: () => Promise<void> }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [expanded, setExpanded] = useState(false);
  const [undoing, setUndoing] = useState(false);
  if (!files.length) return null;
  return <section className="chatChanges" aria-label="Edited files">
    <header><span className="chatChangesIcon"><FileDiff size={19} /></span><div><strong>Edited {files.length} {files.length === 1 ? 'file' : 'files'}</strong><div className="changeCounts"><span className="diffAdded">+{files.reduce((sum, file) => sum + file.added, 0)}</span><span className="diffRemoved">−{files.reduce((sum, file) => sum + file.removed, 0)}</span></div></div><div className="chatChangesActions"><button disabled={!canUndo || undoing} onClick={async () => { if (!window.confirm('Undo these file changes? Later edits that conflict with this patch will be preserved.')) return; setUndoing(true); try { await onUndo(); } finally { setUndoing(false); } }}>{undoing ? 'Undoing…' : 'Undo'}<Undo2 size={13} /></button><button className="viewChanges" onClick={() => onView()}>View changes</button></div></header>
    <div>{(expanded ? files : files.slice(0, 3)).map((file, index) => <button className="changedFileRow" key={`${file.path}-${index}`} onClick={() => onView(file.path)}><span>{file.path}</span><span className="changeCounts"><span className="diffAdded">+{file.added}</span><span className="diffRemoved">−{file.removed}</span></span></button>)}</div>
    {files.length > 3 && <button className="showMoreFiles" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer files' : `Show ${files.length - 3} more files`}<ChevronDown size={14} /></button>}
  </section>;
}
