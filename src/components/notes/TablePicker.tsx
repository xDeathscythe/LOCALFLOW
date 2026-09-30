import { useState } from 'react';
export function TablePicker({ insert, close }: { insert: (rows: number, cols: number, header: boolean) => void; close: () => void }) {
  const [rows, setRows] = useState(3), [cols, setCols] = useState(3), [header, setHeader] = useState(true);
  return <form className="noteTablePicker" onSubmit={event => { event.preventDefault(); insert(rows, cols, header); close(); }}>
    <div className="tableSizeGrid" aria-label="Table size grid">{Array.from({ length: 80 }, (_, i) => <button key={i} type="button" aria-label={`${Math.floor(i / 10) + 1} rows, ${i % 10 + 1} columns`} className={Math.floor(i / 10) < rows && i % 10 < cols ? 'selected' : ''} onMouseEnter={() => { setRows(Math.floor(i / 10) + 1); setCols(i % 10 + 1); }} onClick={() => { insert(Math.floor(i / 10) + 1, i % 10 + 1, header); close(); }} />)}</div>
    <label>Rows<input aria-label="Table rows" type="number" min={1} max={100} value={rows} onChange={e => setRows(Number(e.target.value))} required /></label>
    <label>Columns<input aria-label="Table columns" type="number" min={1} max={50} value={cols} onChange={e => setCols(Number(e.target.value))} required /></label>
    <label><input type="checkbox" checked={header} onChange={e => setHeader(e.target.checked)} />Header row</label><button type="submit">Insert table</button><button type="button" onClick={close}>Cancel</button>
  </form>;
}
