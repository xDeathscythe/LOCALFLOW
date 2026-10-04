import { useState } from 'react';
import { ArrowUpRight, GripVertical, MoreHorizontal, Plus } from 'lucide-react';
import type { DatabaseRow, DatabaseView, NotesDatabase, Property } from '../../lib/database';
import { displayValue } from '../../../host/notes/database-engine.mjs';
import { DatabaseCell } from './DatabaseCell';

export function DatabaseTable({ rows, properties, database, databases, view, pending, color, open, change, changeView, rowMenu, propertyMenu, addProperty, reorder, run }: {
  rows: DatabaseRow[]; properties: Property[]; database: NotesDatabase; databases: NotesDatabase[]; view: DatabaseView; pending: boolean;
  color: (row: DatabaseRow) => string | undefined; open: (id: string) => void; change: (row: DatabaseRow, property: Property, value: unknown) => void;
  changeView: (view: DatabaseView) => void; rowMenu: (row: DatabaseRow, x: number, y: number) => void; propertyMenu: (property: Property, x: number, y: number) => void;
  addProperty: () => void; reorder: (id: string, before: string) => void; run: (row: DatabaseRow, property: Property) => void;
}) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const width = (property: Property) => widths[property.id] || view.widths?.[property.id] || (property.type === 'title' ? 260 : 180);
  const moveProperty = (from: string, to: string) => {
    const order = [...new Set([...(view.order || []), ...database.properties.map(p => p.id)])].filter(id => id !== from);
    order.splice(order.indexOf(to), 0, from); changeView({ ...view, order });
  };
  return <table className="notesDatabaseTable" data-wrap={view.wrap || false} style={{ width: 84 + properties.reduce((sum, p) => sum + width(p), 0) }}>
    <colgroup><col style={{ width: 42 }} />{properties.map(p => <col key={p.id} style={{ width: width(p) }} />)}<col style={{ width: 42 }} /></colgroup>
    <thead><tr><th className="databaseRowHandle" />{properties.map(p => <th key={p.id} draggable={!pending} onDragStart={e => e.dataTransfer.setData('application/localflow-property', p.id)} onDragOver={e => { if (e.dataTransfer.types.includes('application/localflow-property')) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const source=e.dataTransfer.getData('application/localflow-property'); if(source && source !== p.id) moveProperty(source,p.id); }} onContextMenu={e => { e.preventDefault(); propertyMenu(p,e.clientX,e.clientY); }}>
      <button aria-label={`Property menu: ${p.name}`} onClick={e => { const rect=e.currentTarget.getBoundingClientRect(); propertyMenu(p,rect.left,rect.bottom); }}>{p.name}<MoreHorizontal size={14}/></button>
      <span className="databaseColumnResize" role="separator" aria-label={`Resize ${p.name}`} aria-orientation="vertical" tabIndex={0} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();changeView({...view,widths:{...view.widths,[p.id]:Math.max(80,Math.min(800,width(p)+(e.key==='ArrowRight'?20:-20)))}});}}} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); const start=e.clientX, initial=width(p), target=e.currentTarget; target.setPointerCapture(e.pointerId); const move=(event:PointerEvent)=>setWidths(current=>({...current,[p.id]:Math.max(80,Math.min(800,initial+event.clientX-start))})); const end=(event:PointerEvent)=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',cancel);setWidths({});changeView({...view,widths:{...view.widths,[p.id]:Math.max(80,Math.min(800,initial+event.clientX-start))}});}; const cancel=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',cancel);setWidths({});};target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',cancel); }} />
    </th>)}<th><button aria-label="Add property" onClick={addProperty}><Plus size={15}/></button></th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} style={{ backgroundColor: color(row) }} onContextMenu={e => { e.preventDefault(); rowMenu(row,e.clientX,e.clientY); }} onDragOver={e => { if(e.dataTransfer.types.includes('application/localflow-row')) e.preventDefault(); }} onDrop={e => {e.preventDefault();const source=e.dataTransfer.getData('application/localflow-row');if(source && source!==row.id)reorder(source,row.id);}}>
      <td className="databaseRowHandle"><button draggable={!pending} aria-label="Row actions" onDragStart={e=>e.dataTransfer.setData('application/localflow-row',row.id)} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();rowMenu(row,rect.left,rect.bottom);}}><GripVertical size={15}/></button></td>
      {properties.map(p => <td key={p.id}><div className="databaseCell">{row.errors?.[p.id] ? <span className="databaseFormulaError" title={row.errors[p.id]}>{displayValue(row.values[p.id])} ⚠</span> : <DatabaseCell property={p} value={row.values[p.id]} databases={databases} disabled={pending} wrap={view.wrap} run={()=>run(row,p)} save={value=>change(row,p,value)}/>}{p.type==='title'&&row.pageId&&<button title="Open row page" aria-label="Open row page" onClick={()=>open(row.pageId!)}><ArrowUpRight size={14}/></button>}</div></td>)}<td/>
    </tr>)}</tbody><tfoot><tr><td/>{properties.map(p=><td key={p.id}>{p.type==='title'?`${rows.length} rows`:p.type==='number'?`Σ ${rows.reduce((sum,row)=>sum+(Number(row.values[p.id])||0),0).toLocaleString()}`:''}</td>)}<td/></tr></tfoot>
  </table>;
}
