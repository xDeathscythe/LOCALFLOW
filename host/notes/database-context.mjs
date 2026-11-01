import { computedRows } from './database-engine.mjs';

// Follow selected relation IDs, including recursive rollups, without loading whole target tables.
export function rowContext(storage, database, rows) {
  const databases = new Map([[database.id, { ...database, rows: [] }]]), seen = new Map();
  const visit = (id, records) => {
    const value = databases.get(id), known = seen.get(id) || new Set(); seen.set(id, known);
    const fresh = records.filter(row => !known.has(row.id));
    for (const row of fresh) { known.add(row.id); value.rows.push(row); }
    for (const property of value.properties) if (property.type === 'relation' && property.target && storage.database.exists(property.target)) {
      if (!databases.has(property.target)) databases.set(property.target, storage.database.metadata(property.target));
      const selected = [...new Set(fresh.flatMap(row => Array.isArray(row.values[property.id]) ? row.values[property.id] : []))];
      if (selected.length) visit(property.target, storage.database.rows(property.target, selected));
    }
  };
  visit(database.id, rows);
  // Relation aggregation preserves stored table order even when reached through several paths.
  for (const value of databases.values()) if (value.rows.length > 1 && (value.id !== database.id || value.rows.length !== rows.length)) value.rows = storage.database.rows(value.id, value.rows.map(row => row.id));
  const computed = computedRows(databases.get(database.id), [...databases.values()]);
  const wanted = new Set(rows.map(row => row.id));
  const selected = new Map();
  for (const property of database.properties) if (property.type === 'relation' && property.target) {
    const ids = selected.get(property.target) || new Set(); selected.set(property.target, ids);
    for (const row of rows) for (const id of Array.isArray(row.values[property.id]) ? row.values[property.id] : []) ids.add(id);
  }
  return {
    rows: computed.filter(row => wanted.has(row.id)), dependencies: [...databases.keys()],
    related: [...databases.values()].map(value => {
      const title = value.properties.find(property => property.type === 'title').id, ids = selected.get(value.id);
      return { ...value, rows: value.rows.filter(row => ids?.has(row.id) || ids?.has(row.pageId)).map(row => ({ id: row.id, pageId: row.pageId, values: { [title]: row.values[title] } })) };
    }),
  };
}
