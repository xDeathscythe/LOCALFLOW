import { useEffect, useRef, useState } from 'react';

type Option = { value: string; label: string };
export function RelationCell({ name, target, selected, labels, disabled, save }: { name: string; target?: string; selected: string[]; labels: Option[]; disabled: boolean; save: (value: string[]) => void }) {
  const [options, setOptions] = useState<Option[] | null>(null), [open, setOpen] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0);
  useEffect(() => { setOptions(null); return () => { sequence.current++; }; }, [target]);
  const load = async () => {
    if (!target) return; const request = ++sequence.current; setError('');
    try { const options = await window.localflow.notesDatabaseOptions(target); if (sequence.current === request) setOptions(options); }
    catch (error) { if (sequence.current === request) setError(String(error)); }
  };
  return <details className="databaseMulti" aria-label={name} onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open) void load(); }}>
    <summary>{selected.map(id => (options || labels).find(option => option.value === id)?.label || id).join(', ') || '—'}</summary>
    {open && <div>{error ? <span role="alert">{error}<button type="button" onClick={()=>void load()}>Retry</button></span> : options ? options.map(option => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} disabled={disabled} onChange={event => save(event.target.checked ? [...selected, option.value] : selected.filter(id => id !== option.value))}/>{option.label}</label>) : <span>Loading options…</span>}</div>}
  </details>;
}
