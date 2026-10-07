import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = value => {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['path', 'directory'].includes(key)).map(([key, item]) => [key, clean(item)]));
};

// Lives in the canonical Notes transaction: a retry cannot commit a second edit.
export function createNotesSync(storage, methods) {
  const db = storage.db;
  db.exec(`CREATE TABLE IF NOT EXISTS remote_sync_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, kind TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS remote_sync_operations(device_id TEXT NOT NULL, operation_id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(device_id,operation_id));`);
  for (const [table, column, kind] of [['pages', 'id', 'page'], ['documents', 'id', 'page'], ['databases', 'id', 'database'], ['database_rows', 'database_id', 'database']]) {
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = action === 'DELETE' ? 'old' : 'new';
      db.exec(`CREATE TRIGGER IF NOT EXISTS remote_sync_${table}_${action} AFTER ${action} ON ${table} BEGIN
        INSERT INTO remote_sync_changes(id,kind,deleted) VALUES(${row}.${column},'${kind}',${table === 'pages' && action === 'DELETE' ? 1 : 0}); END;`);
    }
  }
  const cursor = () => Number(db.prepare('SELECT coalesce(max(seq),0) AS value FROM remote_sync_changes').get().value);
  const tree = () => clean(methods.list());
  const treeRevision = () => digest(tree().items);
  return {
    syncSnapshot() { return { ...tree(), cursor: cursor(), treeRevision: treeRevision() }; },
    syncChanges({ cursor: after = 0, limit = 250 } = {}) {
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid sync cursor or limit.');
      const latest = cursor();
      if (after > latest) return { reset: true, cursor: latest, changes: [] };
      const changes = db.prepare('SELECT seq AS cursor,id,kind,deleted FROM remote_sync_changes WHERE seq>? ORDER BY seq LIMIT ?').all(after, limit);
      return { changes, cursor: changes.at(-1)?.cursor ?? after, more: (changes.at(-1)?.cursor ?? after) < latest, treeRevision: treeRevision() };
    },
    syncRead(id) { return clean(methods.read(id)); },
    syncApply({ deviceId, operationId, operation, value, treeRevision: expectedTree }) {
      if (![deviceId, operationId].every(id => typeof id === 'string' && /^[\w-]{8,100}$/.test(id))) throw new Error('Invalid sync operation identity.');
      if (!['create', 'save', 'rename', 'move', 'remove', 'restore'].includes(operation)) throw new Error('Unsupported sync operation.');
      const hash = digest({ operation, value });
      const prior = db.prepare('SELECT hash,result FROM remote_sync_operations WHERE device_id=? AND operation_id=?').get(deviceId, operationId);
      if (prior) {
        if (prior.hash !== hash) throw new Error('Operation ID was already used for a different edit.');
        return JSON.parse(prior.result);
      }
      if (operation !== 'save' && expectedTree !== treeRevision()) return { conflict: true, treeRevision: treeRevision() };
      if (operation === 'save') {
        const current = methods.read(value?.id);
        if (value?.revision !== current.revision) return { conflict: true, current: clean(current) };
      }
      const result = { value: clean(methods[operation](value)), cursor: cursor(), treeRevision: treeRevision() };
      db.prepare('INSERT INTO remote_sync_operations VALUES(?,?,?,?)').run(deviceId, operationId, hash, JSON.stringify(result));
      return result;
    },
  };
}
