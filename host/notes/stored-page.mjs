import { displayValue, matches, sortRows } from './database-engine.mjs';
import { rowContext } from './database-context.mjs';

function dateWindow(view, month) {
  if (!month) return;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid database month.');
  const [year, number] = month.split('-').map(Number), first = new Date(year, number - 1, 1);
  const start = view.type === 'calendar' ? new Date(year, number - 1, 1 - (first.getDay() + 6) % 7) : first;
  const end = view.type === 'calendar' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42) : new Date(year, number, 1);
  const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { from: key(start), to: key(end) };
}
const dateKey = value => typeof value === 'string' ? value.slice(0, 10) : value?.start?.slice(0, 10) || '';
function inWindow(value, range, timeline) {
  const date = dateKey(value);
  return !date || !range || (date < range.to && (timeline ? value?.end?.slice(0, 10) || date : date) >= range.from);
}
function filterProperties(filter) {
  return filter?.filters ? filter.filters.flatMap(filterProperties) : filter?.property ? [filter.property] : [];
}

export function storedRow(storage, request) {
  const database = storage.database.metadata(request.id);
  const rows = request.rowId ? [storage.database.row(request.id, request.rowId)?.row].filter(Boolean) : storage.database.rows(request.id, [request.pageId]);
  return { database: { ...database, rows }, ...rowContext(storage, database, rows), total: rows.length, offset: 0 };
}

export function storedPage(storage, request) {
  const database = storage.database.metadata(request.id), db = storage.db;
  if (request.metadataOnly) return { database, rows: [], related: [], dependencies: [database.id], total: 0, offset: 0 };
  const view = database.views.find(view => view.id === request.viewId) || database.views[0];
  const dated = ['calendar', 'timeline'].includes(view.type);
  const dateProperty = dated && (database.properties.find(property => property.id === view.dateProperty) || database.properties.find(property => property.type === 'date'));
  const range = dated ? dateWindow(view, request.month) : undefined;
  const needle = String(request.search || '').toLocaleLowerCase();
  const fields = [...new Set([...filterProperties(view.filter), ...(view.sorts || []).map(sort => sort.property), ...(dateProperty ? [dateProperty.id] : [])])];
  const derived = database.properties.some(property => ['formula', 'rollup'].includes(property.type) && (needle || fields.includes(property.id)));
  let selected, total, earliestDate, dependencies;
  const limit = Math.max(1, Math.min(100, Math.floor(Number(request.limit) || 100)));
  const pageOffset = total => Math.max(0, Math.min(Math.floor(Number(request.offset) || 0), Math.max(0, Math.ceil(total / limit) - 1) * limit));
  let offset;
  if (derived) {
    // Global computed filters/sorts need all source rows, but only referenced target rows.
    const raw = db.prepare('SELECT payload FROM database_rows WHERE database_id=? ORDER BY position').all(database.id).map(row => JSON.parse(row.payload));
    const context = rowContext(storage, database, raw); dependencies = context.dependencies;
    let rows = context.rows.filter(row => matches(row.values, view.filter));
    if (needle) rows = rows.filter(row => Object.values(row.values).some(value => displayValue(value).toLocaleLowerCase().includes(needle)));
    if (dateProperty) {
      earliestDate = rows.map(row => dateKey(row.values[dateProperty.id])).filter(Boolean).sort()[0];
      rows = rows.filter(row => inWindow(row.values[dateProperty.id], range, view.type === 'timeline'));
    }
    sortRows(rows, view.sorts); total = rows.length; offset = pageOffset(total); selected = rows.slice(offset, offset + limit).map(row => row.id);
  } else {
    // Preserve Unicode search semantics; only sort/date keys and the page cross into JS.
    db.function('lf_match', { deterministic: true }, json => {
      const values = JSON.parse(json);
      return matches(values, view.filter) && (!needle.includes('\0') || Object.values(values).some(value => displayValue(value).toLocaleLowerCase().includes(needle))) ? 1 : 0;
    });
    let where = view.filter || needle.includes('\0') ? " AND lf_match(json_extract(payload,'$.values'))" : '';
    if(needle&&!needle.includes('\0'))where+=` AND instr(coalesce((SELECT text FROM database_search s WHERE s.database_id=database_rows.database_id AND s.id=database_rows.id),lf_search_text(json_extract(payload,'$.values'))),${storage.database.literal(needle)})>0`;
    const numericSort=view.sorts?.length===1&&database.properties.find(property=>property.id===view.sorts[0].property)?.type==='number'&&!dateProperty;
    const index=numericSort&&storage.database.sortIndex(database.id,view.sorts[0].property),type=numericSort&&storage.database.sortType(view.sorts[0].property);
    const numeric=index&&!db.prepare(`SELECT 1 FROM database_rows INDEXED BY ${index} WHERE database_id=${storage.database.literal(database.id)} AND ${type} IS NOT NULL AND ${type} NOT IN ('integer','real','null') LIMIT 1`).get();
    if(numeric){
      total=db.prepare(`SELECT count(*) AS count FROM database_rows WHERE database_id=?${where}`).get(database.id).count;offset=pageOffset(total);
      selected=db.prepare(`SELECT id FROM database_rows INDEXED BY ${index} WHERE database_id=${storage.database.literal(database.id)}${where} ORDER BY ${storage.database.sortExpression(view.sorts[0].property)} ${view.sorts[0].direction==='desc'?'DESC':'ASC'},position LIMIT ? OFFSET ?`).all(limit,offset).map(row=>row.id);
    } else if (view.sorts?.length || dateProperty) {
      const keys = fields.map((id, i) => `json_extract(payload,?) AS k${i},json_type(payload,?) AS t${i}`).join(',');
      const paths = fields.flatMap(id => { const path = `$.values.${JSON.stringify(id)}`; return [path, path]; });
      const entries = db.prepare(`SELECT id${keys ? ',' + keys : ''} FROM database_rows WHERE database_id=?${where} ORDER BY position`).all(...paths, database.id);
      let rows = entries.map(entry => ({ id: entry.id, values: Object.fromEntries(fields.map((id, i) => {
        const type = entry[`t${i}`], value = entry[`k${i}`];
        return [id, type === 'array' || type === 'object' ? JSON.parse(value) : type === 'true' ? true : type === 'false' ? false : value];
      })) }));
      if (dateProperty) { earliestDate = rows.map(row => dateKey(row.values[dateProperty.id])).filter(Boolean).sort()[0]; rows = rows.filter(row => inWindow(row.values[dateProperty.id], range, view.type === 'timeline')); }
      sortRows(rows, view.sorts); total = rows.length; offset = pageOffset(total); selected = rows.slice(offset, offset + limit).map(row => row.id);
    } else {
      total = db.prepare(`SELECT count(*) AS count FROM database_rows WHERE database_id=?${where}`).get(database.id).count;
      offset = pageOffset(total);
      selected = db.prepare(`SELECT id FROM database_rows WHERE database_id=?${where} ORDER BY position LIMIT ? OFFSET ?`).all(database.id, limit, offset).map(row => row.id);
    }
  }
  const order = new Map(selected.map((id, index) => [id, index])), raw = storage.database.rows(database.id, selected).filter(row=>order.has(row.id));
  raw.sort((a, b) => order.get(a.id) - order.get(b.id));
  const context = rowContext(storage, database, raw); context.rows.sort((a, b) => order.get(a.id) - order.get(b.id));
  const neighbors = {};
  const adjacent=db.prepare(`SELECT r.id,(SELECT id FROM database_rows WHERE database_id=r.database_id AND position<r.position ORDER BY position DESC LIMIT 1) AS before,(SELECT id FROM database_rows WHERE database_id=r.database_id AND position>r.position ORDER BY position LIMIT 1) AS after FROM database_rows r INDEXED BY sqlite_autoindex_database_rows_1 WHERE database_id=? AND id IN (SELECT value FROM json_each(?))`).all(database.id,JSON.stringify(selected));
  for(const row of adjacent)neighbors[row.id]={...(row.before?{before:row.before}:{}),...(row.after?{after:row.after}:{})};
  return { database: { ...database, rows: raw }, ...context, dependencies: dependencies || context.dependencies, total, offset, viewId: view.id, earliestDate, queryError: '', neighbors };
}
