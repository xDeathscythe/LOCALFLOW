import { useEffect, useRef, useState } from 'react';
import type { Property, NotesDatabase } from '../../lib/database';
import { displayValue } from '../../../electron/notes/database-engine.mjs';
import { EntriesCell } from './EntriesCell';
import { RelationCell } from './RelationCell';
export function DatabaseCell({ property, value, save, databases, disabled, run, wrap = false }: { property: Property; value: unknown; save: (value: unknown) => void; databases: NotesDatabase[]; disabled: boolean; run?: () => void; wrap?: boolean }) {
  const [draft, setDraft] = useState(displayValue(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(displayValue(value)), [value]);
  if (property.type === 'button') return <button type="button" disabled={disabled || !property.actions?.length} title={property.warning} onClick={run}>{property.buttonLabel || property.name}</button>;
  if (property.readonly || ['formula','rollup'].includes(property.type)) return <span className="computedValue" title={property.warning}>{displayValue(value)}{property.warning && ' ⚠'}</span>;
  if (property.type === 'checkbox') return <input aria-label={property.name} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={e => save(e.target.checked)} />;
  if (['select','status'].includes(property.type)) return <select aria-label={property.name} value={displayValue(value)} disabled={disabled} onChange={e => save(e.target.value)}><option value="" />{(property.options || []).map(option => <option key={option.name} value={option.name}>{option.name}</option>)}{value && !property.options?.some(o => o.name === value) ? <option>{displayValue(value)}</option> : null}</select>;
  if (['multi_select','relation'].includes(property.type)) {
    const target = databases.find(db => db.id === property.target), title = target?.properties.find(p => p.type === 'title');
    const options = property.type === 'relation' ? (target?.rows || []).map(row => ({ value: row.pageId || row.id, label: displayValue(row.values[title?.id || 'title']) || 'Untitled' })) : (property.options || []).map(o => ({ value: o.name, label: o.name }));
    const selected = Array.isArray(value) ? value.map(String) : [];
    if (property.type === 'relation') return <RelationCell name={property.name} target={property.target} selected={selected} labels={options} disabled={disabled} save={save}/>;
    return <details className="databaseMulti"><summary>{selected.map(id => options.find(o => o.value === id)?.label || id).join(', ') || '—'}</summary><div>{options.map(o => <label key={o.value}><input type="checkbox" checked={selected.includes(o.value)} disabled={disabled} onChange={e => save(e.target.checked ? [...selected, o.value] : selected.filter(v => v !== o.value))} />{o.label}</label>)}</div></details>;
  }
  if (property.type === 'date') {
    const date = value && typeof value === 'object' ? value as { start?: string; end?: string } : { start: displayValue(value) };
    return <div className="databaseDate"><input aria-label={`${property.name} start`} type="date" disabled={disabled} value={date.start?.slice(0,10) || ''} onChange={e => save({ ...date, start: e.target.value })} /><input aria-label={`${property.name} end`} type="date" disabled={disabled} value={date.end?.slice(0,10) || ''} onChange={e => save({ ...date, end: e.target.value })} /></div>;
  }
  if (['person','files'].includes(property.type)) return <EntriesCell property={property} value={value} disabled={disabled} save={save}/>;
  if(property.type==='text')return <textarea aria-label={property.name} className="databaseTextCell" rows={wrap?Math.min(8,Math.max(2,draft.split('\n').length)):1} value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={()=>{if(cancelled.current){cancelled.current=false;return;}if(draft!==displayValue(value))save(draft);}} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))e.currentTarget.blur();if(e.key==='Escape'){cancelled.current=true;setDraft(displayValue(value));e.currentTarget.blur();}}}/>;
  return <input aria-label={property.name} type={property.type === 'number' ? 'number' : 'text'} step="any" value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={() => { if (cancelled.current) { cancelled.current = false; return; } if (draft !== displayValue(value)) save(property.type === 'number' ? draft === '' ? null : Number(draft) : draft); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; setDraft(displayValue(value)); e.currentTarget.blur(); } }} />;
}
