import { randomUUID } from 'node:crypto';
import { queryRows } from './database-engine.mjs';
import { openNotesDatabase } from './sqlite-store.mjs';

const types = ['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'person', 'files', 'relation', 'formula', 'rollup', 'button'];
export function validateDatabase(value) {
  if (!value || !Array.isArray(value.properties) || !Array.isArray(value.rows) || !Array.isArray(value.views)) throw new Error('Invalid database.');
  if (value.properties.length > 200 || value.rows.length > 50000 || !value.views.length || value.views.length > 100) throw new Error('Database needs 1–100 views, at most 200 properties and 50000 rows.');
  const unique = list => { const ids = new Set(); for (const item of list) { if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('Duplicate or missing ID.'); ids.add(item.id); } };
  unique(value.properties); unique(value.rows); unique(value.views);
  if(new Set(value.properties.map(p=>p.name)).size!==value.properties.length)throw new Error('Property names must be unique.');
  for (const property of value.properties) if (!types.includes(property.type) || typeof property.name !== 'string' || !property.name.trim()) throw new Error('Invalid property.');
  for(const property of value.properties)if(property.actions&&(!Array.isArray(property.actions)||property.actions.length>10||property.actions.some(a=>!['add_row','edit_row'].includes(a.type)||!a.values||typeof a.values!=='object')))throw new Error('Invalid button actions.');
  if (value.properties.filter(p => p.type === 'title').length !== 1) throw new Error('A database needs one title property.');
  for (const row of value.rows) if (!row.values || typeof row.values !== 'object' || Array.isArray(row.values)) throw new Error('Invalid row.');
  const condition = (filter, depth = 0) => { if (!filter) return; if (depth > 12 || typeof filter !== 'object') throw new Error('Invalid condition.'); if (filter.filters) { if (!['and','or'].includes(filter.operator) || !Array.isArray(filter.filters) || filter.filters.length > 100) throw new Error('Invalid condition group.'); filter.filters.forEach(f => condition(f, depth + 1)); } else if (!['is','is_not','contains','not_contains','empty','not_empty','gt','gte','lt','lte','before','after','relative_date'].includes(filter.operator) || !value.properties.some(p => p.id === filter.property)) throw new Error('Invalid condition property or operator.'); };
  for(const view of value.views){
    if(view.widths&&(typeof view.widths!=='object'||Array.isArray(view.widths)||Object.entries(view.widths).some(([id,width])=>!value.properties.some(p=>p.id===id)||!Number.isFinite(width)||width<80||width>800)))throw new Error('Invalid column widths.');
    if(view.order&&(!Array.isArray(view.order)||new Set(view.order).size!==view.order.length||view.order.some(id=>!value.properties.some(p=>p.id===id))))throw new Error('Invalid column order.');
    if(view.wrap!==undefined&&typeof view.wrap!=='boolean')throw new Error('Invalid wrapping option.');
  }
  for (const view of value.views) { if (!['table','board','list','gallery','calendar','timeline','form'].includes(view.type) || typeof view.name !== 'string' || !view.name.trim()) throw new Error('Invalid view.'); condition(view.filter); for(const sort of view.sorts||[])if(!['asc','desc'].includes(sort.direction)||!value.properties.some(p=>p.id===sort.property))throw new Error('Invalid sort.'); for (const color of view.colors || []) { if (!/^#[0-9a-f]{6}$/i.test(color.color)) throw new Error('Invalid conditional color.'); condition(color.filter); } }
  if (JSON.stringify(value).length > 50_000_000) throw new Error('Database is too large.');
  return value;
}
export function createDatabaseStore(root, changed = () => {}, storage = openNotesDatabase(root)) {
  const check = id => { if (!/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid database ID.'); };
  const read = id => { check(id); return storage.database.read(id); };
  return {
    read,
    create(id, value) { check(id); if (storage.database.exists(id)) return read(id); const database = value || { id, properties: [{ id: 'title', name: 'Name', type: 'title' }], views: [{ id: randomUUID(), name: 'Table', type: 'table', sorts: [], colors: [] }], rows: [] }; return storage.transaction(() => storage.database.write(validateDatabase({ ...database, id }))); },
    save(value) { check(value.id); const { revision:previous,...next }=value;validateDatabase(next); const result=storage.transaction(()=>storage.database.write(next,previous));changed({ids:[value.id],tree:false});return result; },
    query({ id, viewId, databases = [] }) { const database = read(id); return queryRows(database, database.views.find(view => view.id === viewId), databases); },
  };
}
