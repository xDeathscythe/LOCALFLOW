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

export function databasePage(store, request) {
  if (request.metadataOnly) return { database: { ...store.databaseRead(request.id), rows: [] }, rows: [], related: [], total: 0, offset: 0 };
  const { database, view, rows, related, earliestDate, queryError } = query(store, request);
  const limit = Math.max(1, Math.min(100, Math.floor(Number(request.limit) || 100)));
  const offset = Math.max(0, Math.min(Math.floor(Number(request.offset) || 0), Math.max(0, Math.ceil(rows.length / limit) - 1) * limit));
  const page = rows.slice(offset, offset + limit), ids = new Set(page.map(row => row.id));
  const neighbors = {};
  for (let i = 0; i < database.rows.length; i++) if (ids.has(database.rows[i].id)) neighbors[database.rows[i].id] = { before: database.rows[i-1]?.id, after: database.rows[i+1]?.id };
  // Send only selected relation labels. The full option list is requested when its editor opens.
  const selected = new Map();
  for (const property of database.properties) if (property.type === 'relation' && property.target) {
    if (!selected.has(property.target)) selected.set(property.target, new Set());
    for (const row of page) for (const id of Array.isArray(row.values[property.id]) ? row.values[property.id] : []) selected.get(property.target).add(id);
  }
  return {
    database: { ...database, rows: database.rows.filter(row => ids.has(row.id)) }, rows: page, total: rows.length, offset, viewId: view.id, earliestDate, queryError, neighbors,
    related: [...related.values()].map(value => {
      const title = value.properties.find(property => property.type === 'title').id, wanted = selected.get(value.id);
      return { ...value, rows: value.rows.filter(row => wanted?.has(row.id) || wanted?.has(row.pageId)).map(row => ({ id: row.id, pageId: row.pageId, values: { [title]: row.values[title] } })) };
    }),
  };
}

export function databasePatch(store, patch) {
  const current = store.databaseRead(patch.id);
  if (patch.revision !== current.revision) throw new Error('This database changed elsewhere. Reload before saving.');
  const properties = patch.properties || current.properties, propertyIds = new Set(properties.map(property => property.id));
  const deletedProperties = current.properties.filter(property => !propertyIds.has(property.id));
  const updates = new Map((patch.rows || []).map(row => [row.id, row.values])), removed = new Set(patch.deleteRows || []);
  for (const id of [...updates.keys(), ...removed]) if (!current.rows.some(row => row.id === id)) throw new Error('Database row not found.');
  if (patch.copyProperty && (!current.properties.some(property => property.id === patch.copyProperty.from) || !propertyIds.has(patch.copyProperty.to))) throw new Error('Invalid copied property.');
  const rows = current.rows.filter(row => !removed.has(row.id)).map(row => {
    const values = { ...row.values, ...updates.get(row.id) };
    if (patch.copyProperty) values[patch.copyProperty.to] = row.values[patch.copyProperty.from];
    for (const property of deletedProperties) delete values[property.id];
    return { ...row, values };
  });
  if (patch.reorder) {
    const index = rows.findIndex(row => row.id === patch.reorder.id), before = rows.findIndex(row => row.id === patch.reorder.beforeId);
    if (index < 0 || before < 0 || index === before) throw new Error('Invalid row order.');
    const [moved] = rows.splice(index, 1); rows.splice(rows.findIndex(row => row.id === patch.reorder.beforeId), 0, moved);
  }
  return { revision: store.databaseSave({ ...current, properties, views: patch.views || current.views, rows }).revision };
}

export function databasePageAction(store, value) {
  const current = store.databaseRead(value.id);
  if (value.revision && value.revision !== current.revision) throw new Error('This database changed elsewhere. Reload before saving.');
  const row = current.rows.find(row => row.id === value.rowId);
  if (value.action !== 'add' && !row) throw new Error('Database row not found.');
  switch (value.action) {
    case 'add': store.databaseAddRow(value); break;
    case 'duplicate': store.databaseAddRow({ id: value.id, label: displayValue(row.values[current.properties.find(p => p.type === 'title').id]) + ' (copy)', values: row.values, templateId: row.pageId }); break;
    case 'remove': if (row.pageId) store.remove(row.pageId); else databasePatch(store, { ...value, revision: current.revision, deleteRows: [row.id] }); break;
    case 'move': store.databaseMoveRow(value); break;
    case 'run': store.databaseRunButton(value); break;
    default: throw new Error('Invalid database action.');
  }
  return { revision: store.databaseRead(value.id).revision };
}

export function databaseOptions(store, id) {
  const database = store.databaseRead(id), title = database.properties.find(property => property.type === 'title').id;
  return database.rows.map(row => ({ value: row.pageId || row.id, label: displayValue(row.values[title]) || 'Untitled' }));
}

export function databaseExport(store, request) {
  const { database, view, rows, queryError } = query(store, request);
  if (queryError) throw new Error(queryError);
  const properties = [...new Set([...(view.order || []), ...database.properties.map(property => property.id)])].map(id => database.properties.find(property => property.id === id)).filter(property => property && (!view.visible || view.visible.includes(property.id) || property.type === 'title'));
  const quote = value => `"${displayValue(value).replace(/"/g, '""')}"`;
  return [properties.map(property => quote(property.name)).join(','), ...rows.map(row => properties.map(property => quote(row.values[property.id])).join(','))].join('\r\n');
}
