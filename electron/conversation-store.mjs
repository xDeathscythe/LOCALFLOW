import { relative } from 'node:path';
import { readJsonFile } from './niwa/host/niwa-store.mjs';

// The history connection already uses WAL. Persist only new or explicitly changed messages.
export function createConversationStore(db, directory, onError, delay = 100) {
  db.exec(`CREATE TABLE IF NOT EXISTS conversations(file TEXT PRIMARY KEY, metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversation_messages(file TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(file,position));`);
  const metadata = db.prepare('INSERT INTO conversations VALUES(?,?) ON CONFLICT(file) DO UPDATE SET metadata=excluded.metadata');
  const message = db.prepare('INSERT INTO conversation_messages VALUES(?,?,?) ON CONFLICT(file,position) DO UPDATE SET payload=excluded.payload');
  const count = db.prepare('SELECT count(*) AS count FROM conversation_messages WHERE file=?');
  const pending = new Map(), lengths = new Map();
  let timer;
  const key = file => relative(directory, file).replaceAll('\\', '/');
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    for (const [file, { value, changed }] of pending) {
      const { transcript, ...rest } = value;
      const start = lengths.get(file) ?? Number(count.get(file).count);
      db.exec('BEGIN');
      try {
        metadata.run(file, JSON.stringify(rest));
        for (let index = start; index < transcript.length; index++) message.run(file, index, JSON.stringify(transcript[index]));
        for (const index of changed) if (index < start && transcript[index]) message.run(file, index, JSON.stringify(transcript[index]));
        if (transcript.length < start) db.prepare('DELETE FROM conversation_messages WHERE file=? AND position>=?').run(file, transcript.length);
        db.exec('COMMIT'); lengths.set(file, transcript.length); pending.delete(file);
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    }
  };
  const write = (file, value, changedMessages = []) => {
    file = key(file);
    const changed = pending.get(file)?.changed || new Set();
    for (const item of changedMessages) { const index = value.transcript.indexOf(item); if (index >= 0) changed.add(index); }
    pending.set(file, { value, changed });
    timer ??= setTimeout(() => { try { flush(); } catch (error) { onError(error); } }, delay);
  };
  return {
    write, flush,
    read(file, fallback) {
      const pendingValue = pending.get(key(file));
      if (pendingValue) return pendingValue.value;
      const saved = db.prepare('SELECT metadata FROM conversations WHERE file=?').get(key(file));
      if (saved) {
        const transcript = db.prepare('SELECT payload FROM conversation_messages WHERE file=? ORDER BY position').all(key(file)).map(row => JSON.parse(row.payload));
        lengths.set(key(file), transcript.length);
        return { ...JSON.parse(saved.metadata), transcript };
      }
      // Import once. Existing JSON is a recovery copy; all subsequent writes use SQLite.
      const value = readJsonFile(file, fallback); write(file, value); flush(); return value;
    },
  };
}
