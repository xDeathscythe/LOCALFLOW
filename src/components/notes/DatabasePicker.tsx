import { useEffect, useState } from 'react';
import type { NoteNode } from '../../lib/workspace';

export function DatabasePicker({ noteId, kind = 'database', insert, close }: { noteId?: string; kind?: 'database' | 'note'; insert: (id: string, label: string) => void; close: () => void }) {
  const [databases, setDatabases] = useState<NoteNode[]>([]), [query, setQuery] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { let live = true; void window.localflow.notesList().then(value => { const collect = (items: NoteNode[]): NoteNode[] => items.flatMap(item => [...(item.kind === kind ? [item] : []), ...collect(item.children || [])]); if (live) setDatabases(collect(value.items)); }).catch(e => { if (live) setError(String(e)); }); return () => { live = false; }; }, [kind]);
  return <div className="noteModalShade" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><form className="noteInsertDialog" role="dialog" aria-modal="true" aria-label={kind === 'database' ? 'Insert database' : 'Insert page'} onSubmit={async event => { event.preventDefault(); if (!query.trim()) return; setPending(true); try { const db = await window.localflow.notesCreate({ kind, label: query.trim(), parentId: noteId }); insert(db.id, db.label); close(); } catch (e) { setError(String(e)); } finally { setPending(false); } }}>
    <header><strong>Insert {kind === 'database' ? 'database' : 'page'}</strong><button type="button" aria-label="Close database picker" onClick={close}>×</button></header>
    <input autoFocus aria-label="Database name or search" placeholder={kind === 'database' ? 'Name a new database or find an existing one…' : 'Name a new page or find an existing one…'} value={query} onChange={e => setQuery(e.target.value)} />
    <button type="submit" disabled={!query.trim() || pending}>Create new {kind === 'database' ? 'database' : 'page'}</button>
    <div className="noteDatabaseChoices">{databases.filter(item => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <button key={item.id} type="button" onClick={() => { insert(item.id, item.label); close(); }}>{item.label}</button>)}</div>
    {error && <p role="alert">{error}</p>}
  </form></div>;
}
