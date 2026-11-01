import { displayValue, queryRows } from './database-engine.mjs';

function query(store, { id, viewId, search = '', month }) {
  const related = new Map();
  const visit = id => {
    if (related.has(id)) return;
    const database = store.databaseRead(id); related.set(id, database);
    for (const property of database.properties) if (property.type === 'relation' && property.target) visit(property.target);
  };
  visit(id);
  const database = related.get(id), view = database.views.find(view => view.id === viewId) || database.views[0];
  const needle = String(search).toLocaleLowerCase();
  let rows, queryError = '';
  try { rows = queryRows(database, view, [...related.values()]); }
  catch (error) { rows = []; queryError = String(error.message || error); }
  if (needle) rows = rows.filter(row => Object.values(row.values).some(value => displayValue(value).toLocaleLowerCase().includes(needle)));
  const dateProperty = database.properties.find(property => property.id === view.dateProperty) || database.properties.find(property => property.type === 'date');
  let earliestDate;
  if (dateProperty && ['calendar', 'timeline'].includes(view.type)) {
    const dateKey = value => typeof value === 'string' ? value.slice(0, 10) : value?.start?.slice(0, 10) || '';
    for (const row of rows) { const date = dateKey(row.values[dateProperty.id]); if (date && (!earliestDate || date < earliestDate)) earliestDate = date; }
    if (month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid database month.');
      const [year, number] = month.split('-').map(Number), first = new Date(year, number - 1, 1);
      const key = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      const start = view.type === 'calendar' ? new Date(year, number - 1, 1 - (first.getDay()+6)%7) : first;
      const end = view.type === 'calendar' ? new Date(start.getFullYear(), start.getMonth(), start.getDate()+42) : new Date(year, number, 1);
      const from = key(start), to = key(end);
      rows = rows.filter(row => { const value = row.values[dateProperty.id], date = dateKey(value); return !date || (date < to && (view.type === 'timeline' ? value?.end?.slice(0,10) || date : date) >= from); });
    }
  }
  return { database, view, related, rows, earliestDate, queryError };
}
export function databasePageAction(store, value) {
  const current = value.rowId ? store.databaseRow({id:value.id,rowId:value.rowId}).database : store.databasePage({id:value.id,metadataOnly:true}).database;
  if (value.revision && value.revision !== current.revision) throw new Error('This database changed elsewhere. Reload before saving.');
  const row = current.rows.find(row => row.id === value.rowId);
  if (value.action !== 'add' && !row) throw new Error('Database row not found.');
  switch (value.action) {
    case 'add': store.databaseAddRow(value); break;
    case 'duplicate': store.databaseAddRow({ id: value.id, label: displayValue(row.values[current.properties.find(p => p.type === 'title').id]) + ' (copy)', values: row.values, templateId: row.pageId }); break;
    case 'remove': if (row.pageId) store.remove(row.pageId); else store.databasePatch( { ...value, revision: current.revision, deleteRows: [row.id] }); break;
    case 'move': store.databaseMoveRow(value); break;
    case 'run': store.databaseRunButton(value); break;
    default: throw new Error('Invalid database action.');
  }
  return { revision: store.databasePage({id:value.id,metadataOnly:true}).database.revision };
}

export function databaseExport(store, request) {
  const { database, view, rows, queryError } = query(store, request);
  if (queryError) throw new Error(queryError);
  const properties = [...new Set([...(view.order || []), ...database.properties.map(property => property.id)])].map(id => database.properties.find(property => property.id === id)).filter(property => property && (!view.visible || view.visible.includes(property.id) || property.type === 'title'));
  const quote = value => `"${displayValue(value).replace(/"/g, '""')}"`;
  return [properties.map(property => quote(property.name)).join(','), ...rows.map(row => properties.map(property => quote(row.values[property.id])).join(','))].join('\r\n');
}
