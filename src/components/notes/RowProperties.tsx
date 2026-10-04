import { useEffect, useRef, useState } from 'react';
import type { DatabasePageResult } from '../../lib/database';
import { DatabaseCell } from './DatabaseCell';

export function RowProperties({ databaseId, pageId }: { databaseId: string; pageId: string }) {
  const [result, setResult] = useState<DatabasePageResult>(), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const sequence = useRef(0), dependencies = useRef([databaseId]);
  const load = async () => {
    const current = ++sequence.current;
    try {
      const value = await window.localflow.notesDatabaseRow({ id: databaseId, pageId });
      if (current === sequence.current) { dependencies.current = value.dependencies || [databaseId]; setResult(value); setError(''); }
    } catch (error) { if (current === sequence.current) setError(String(error)); }
  };
  useEffect(() => {
    setResult(undefined); dependencies.current = [databaseId]; void load();
    let timer: ReturnType<typeof setTimeout>;
    const off = window.localflow.onNiwaEvent(event => {
      if (event.type === 'notes-changed' && (!event.ids?.length || event.ids.some(id => dependencies.current.includes(id)))) {
        clearTimeout(timer); timer = setTimeout(() => void load(), 100);
      }
    });
    return () => { sequence.current++; clearTimeout(timer); off(); };
  }, [databaseId, pageId]);
  const database = result?.database, row = result?.rows[0];
  if (!database || !row) return error ? <p role="alert">{error}</p> : null;
  const change = async (operation: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true); setError('');
    try { await operation(); await load(); } catch (error) { setError(String(error)); } finally { setPending(false); }
  };
  return <details className="noteRowProperties" open><summary>Properties</summary>{error && <p role="alert">{error}</p>}
    {database.properties.filter(property => property.type !== 'title').map(property => <div key={property.id}>
      <label>{property.name}</label><div className="databaseCell">
        <DatabaseCell property={property} value={row.values[property.id]} databases={result.related} disabled={pending}
          run={() => void change(() => window.localflow.notesDatabasePageAction({ id: databaseId, rowId: row.id, propertyId: property.id, revision: database.revision, action: 'run' }))}
          save={value => change(() => window.localflow.notesDatabasePatch({ id: databaseId, revision: database.revision, rows: [{ id: row.id, values: { [property.id]: value } }] }))} />
        {row.errors?.[property.id] && <span className="databaseFormulaError" title={row.errors[property.id]}>⚠</span>}
      </div></div>)}
  </details>;
}
