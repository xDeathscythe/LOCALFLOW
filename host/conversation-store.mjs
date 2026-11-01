import { relative } from 'node:path';
import { readJsonFile } from './niwa/host/niwa-store.mjs';

// The history connection already uses WAL. Persist only new or explicitly changed messages.
export function createConversationStore(db, directory, onError, delay = 100) {
  db.exec(`CREATE TABLE IF NOT EXISTS conversations(file TEXT PRIMARY KEY, metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversation_messages(file TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(file,position));
    CREATE INDEX IF NOT EXISTS conversation_message_ids ON conversation_messages(file,json_extract(payload,'$.id'));`);
  const metadata = db.prepare('INSERT INTO conversations VALUES(?,?) ON CONFLICT(file) DO UPDATE SET metadata=excluded.metadata');
  const message = db.prepare('INSERT INTO conversation_messages VALUES(?,?,?) ON CONFLICT(file,position) DO UPDATE SET payload=excluded.payload');
  const count = db.prepare('SELECT count(*) AS count FROM conversation_messages WHERE file=?');
  const pending = new Map(), lengths = new Map();
  let timer;
  const key = file => relative(directory, file).replaceAll('\\', '/');
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    for (const [file, { value, changed }] of pending) {
      const { transcript, messageOffset = 0, ...rest } = value;
      const start = lengths.get(file) ?? Number(count.get(file).count);
      db.exec('BEGIN');
      try {
        metadata.run(file, JSON.stringify(rest));
        for (let index = Math.max(start, messageOffset); index < messageOffset + transcript.length; index++) message.run(file, index, JSON.stringify(transcript[index - messageOffset]));
        for (const index of changed) if (index < start && transcript[index - messageOffset]) message.run(file, index, JSON.stringify(transcript[index - messageOffset]));
        const total = messageOffset + transcript.length;
        if (total < start) db.prepare('DELETE FROM conversation_messages WHERE file=? AND position>=?').run(file, total);
        db.exec('COMMIT'); lengths.set(file, total); pending.delete(file);
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    }
  };
  const write = (file, value, changedMessages = []) => {
    file = key(file);
    const changed = pending.get(file)?.changed || new Set();
    for (const item of changedMessages) { const index = value.transcript.indexOf(item); if (index >= 0) changed.add((value.messageOffset || 0) + index); }
    pending.set(file, { value, changed });
    timer ??= setTimeout(() => { try { flush(); } catch (error) { onError(error); } }, delay);
  };
  return {
    write, flush,
    has(file, id) { return Boolean(db.prepare("SELECT 1 FROM conversation_messages WHERE file=? AND json_extract(payload,'$.id')=?").get(key(file), id)); },
    metadata(file) { const saved=db.prepare('SELECT metadata FROM conversations WHERE file=?').get(key(file));return saved?JSON.parse(saved.metadata):readJsonFile(file,{}); },
    range(file, offset, limit) {
      const value=pending.get(key(file))?.value;
      if(value && offset >= (value.messageOffset || 0)) return value.transcript.slice(offset-(value.messageOffset||0),offset-(value.messageOffset||0)+limit);
      flush();
      return db.prepare('SELECT payload FROM conversation_messages WHERE file=? AND position>=? ORDER BY position LIMIT ?').all(key(file),offset,limit).map(row=>JSON.parse(row.payload));
    },
    read(file, fallback, limit = 100) {
      const pendingValue = pending.get(key(file));
      if (pendingValue) return pendingValue.value;
      const saved = db.prepare('SELECT metadata FROM conversations WHERE file=?').get(key(file));
      if (saved) {
        const total=Number(count.get(key(file)).count), messageOffset=Math.max(0,total-limit);
        const transcript=this.range(file,messageOffset,limit);
        lengths.set(key(file), total);
        return { ...JSON.parse(saved.metadata), ...(messageOffset ? {messageOffset} : {}), transcript };
      }
      // Import once. Existing JSON is a recovery copy; all subsequent writes use SQLite.
      const value = readJsonFile(file, fallback); write(file, value); flush();
      return this.read(file,fallback,limit);
    },
  };
}
