import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export function createNiwaHistory(dataDir) {
  const db = new DatabaseSync(join(dataDir, "history.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, session TEXT, project TEXT, role TEXT, content TEXT, timestamp INTEGER);
    CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(content, content='messages', content_rowid='rowid', tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS history_insert AFTER INSERT ON messages BEGIN INSERT INTO history_fts(rowid, content) VALUES(new.rowid,new.content); END;
    CREATE TRIGGER IF NOT EXISTS history_delete AFTER DELETE ON messages BEGIN INSERT INTO history_fts(history_fts,rowid,content) VALUES('delete',old.rowid,old.content); END;
    CREATE INDEX IF NOT EXISTS history_session ON messages(session);
    CREATE TABLE IF NOT EXISTS user_model(id TEXT PRIMARY KEY, dimension TEXT, observation TEXT, evidence TEXT, confidence REAL, updated INTEGER);`);
  const insert = db.prepare("INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?)");
  const indexed = new Map();
  const sync = (session) => {
    if (session.parentId || session.source === "niwa-code-side-chat") return;
    const offset = indexed.get(session.id) ?? Number(db.prepare("SELECT count(*) AS n FROM messages WHERE session=?").get(session.id).n);
    if (offset === session.transcript.length) return;
    db.exec("BEGIN");
    try { session.transcript.slice(offset).forEach((m, i) => insert.run(`${session.id}:${offset + i}`, session.id, session.projectId, m.role, m.content, m.timestamp ?? 0)); db.exec("COMMIT"); indexed.set(session.id, session.transcript.length); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const search = ({ query, project, limit = 10 }) => {
    if (typeof query !== "string" || !query.trim() || query.length > 1000) throw new Error("Search query must contain 1–1000 characters.");
    limit = Math.min(30, Math.max(1, limit));
    const terms = query.trim().split(/\s+/u).map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    const rows = db.prepare(`SELECT m.id,m.session,m.project,m.role,m.content,m.timestamp FROM history_fts f JOIN messages m ON m.rowid=f.rowid WHERE history_fts MATCH ? ${project ? "AND m.project=?" : ""} ORDER BY bm25(history_fts) LIMIT ?`).all(terms, ...project ? [project] : [], limit);
    // Substring search covers scripts without spaces and identifiers not tokenized by FTS5.
    if (!rows.length) rows.push(...db.prepare(`SELECT * FROM messages WHERE instr(lower(content),lower(?)) > 0 ${project ? "AND project=?" : ""} ORDER BY timestamp DESC LIMIT ?`).all(query, ...project ? [project] : [], limit));
    return rows.map((row) => ({ ...row, content: row.content.slice(0, 6000) }));
  };
  return {
    sync, search,
    read: (session, offset = 0, limit = 20) => db.prepare("SELECT * FROM messages WHERE session=? ORDER BY rowid LIMIT ? OFFSET ?").all(session, Math.min(50, limit), Math.max(0, offset)),
    forget: (session) => { indexed.delete(session); db.prepare("DELETE FROM messages WHERE session=?").run(session); db.prepare("DELETE FROM user_model WHERE EXISTS (SELECT 1 FROM json_each(user_model.evidence) WHERE value LIKE ?)").run(`${session}:%`); },
    model: () => db.prepare("SELECT * FROM user_model ORDER BY updated DESC LIMIT 50").all().map((row) => ({ ...row, evidence: JSON.parse(row.evidence) })),
    observe: ({ id, dimension, observation, evidence, confidence }) => {
      if (!id || !dimension || !observation?.trim() || observation.length > 1000 || !evidence?.length || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("A bounded observation, confidence and source message IDs are required.");
      for (const source of evidence) if (!db.prepare("SELECT id FROM messages WHERE id=? AND role='user'").get(source)) throw new Error("User model evidence must reference an existing user message.");
      db.prepare("INSERT OR REPLACE INTO user_model VALUES(?,?,?,?,?,?)").run(id, dimension, observation, JSON.stringify(evidence), confidence, Date.now());
      return { saved: true, id };
    },
    forgetObservation: (id) => { db.prepare("DELETE FROM user_model WHERE id=?").run(id); return { ok: true }; },
    close: () => { if (db.isOpen) db.close(); },
  };
}
