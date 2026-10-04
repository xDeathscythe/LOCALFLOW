import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// One authoritative transactional store. Old files are a recovery snapshot, not a second writer.
export function openNotesDatabase(root) {
  mkdirSync(root, { recursive:true });
  const db = new DatabaseSync(join(root,'workspace.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workspace_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pages(id TEXT PRIMARY KEY,parent_id TEXT,position INTEGER NOT NULL,metadata TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS pages_parent ON pages(parent_id,position);
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,content TEXT NOT NULL,rich TEXT);
    CREATE TABLE IF NOT EXISTS versions(version_id INTEGER PRIMARY KEY,id TEXT NOT NULL,revision TEXT NOT NULL,created INTEGER NOT NULL,snapshot TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS versions_page ON versions(id,version_id);
    CREATE TABLE IF NOT EXISTS databases(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS database_rows(database_id TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(database_id,id));
    CREATE INDEX IF NOT EXISTS database_rows_position ON database_rows(database_id,position);
  `);
  const transaction = fn => {
    if (db.isTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  };
  const readJson = (file,fallback) => existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : fallback;
  const meta = db.prepare('SELECT value FROM workspace_meta WHERE key=?');
  const putMeta = db.prepare('INSERT INTO workspace_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value!=excluded.value');
  const putPage = db.prepare('INSERT INTO pages VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,position=excluded.position,metadata=excluded.metadata WHERE parent_id IS NOT excluded.parent_id OR position!=excluded.position OR metadata!=excluded.metadata');
  const putDoc = db.prepare('INSERT INTO documents VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,rich=excluded.rich');
  const putRow = db.prepare('INSERT INTO database_rows VALUES(?,?,?,?) ON CONFLICT(database_id,id) DO UPDATE SET position=excluded.position,payload=excluded.payload WHERE position!=excluded.position OR payload!=excluded.payload');
  const writeState = (state, ids = [], tree = true) => {
    const seen = new Set(), selected = new Set(ids);
    const visit = (items,parent=null) => items.forEach((item,position) => {
      const {children,...metadata} = item; seen.add(item.id);
      if (tree || selected.has(item.id)) putPage.run(item.id,parent,position,JSON.stringify(metadata));
      visit(children || [],item.id);
    }); visit(state.items);
    if (tree) for (const {id} of db.prepare('SELECT id FROM pages').all()) if (!seen.has(id)) db.prepare('DELETE FROM pages WHERE id=?').run(id);
    const {items,...metadata} = state;
    if (tree) for (const [key,value] of Object.entries(metadata)) putMeta.run(key,JSON.stringify(value));
  };
  const readState = () => {
    const items = new Map(db.prepare('SELECT * FROM pages ORDER BY parent_id,position').all().map(row => [row.id,{...JSON.parse(row.metadata),children:[],parent:row.parent_id}]));
    const roots = [];
    for (const item of items.values()) { const parent=items.get(item.parent); delete item.parent; (parent?parent.children:roots).push(item); }
    const state = Object.fromEntries(db.prepare("SELECT key,value FROM workspace_meta WHERE key!='migration-complete'").all().map(row=>[row.key,JSON.parse(row.value)]));
    return {...state,items:roots};
  };
  const database = {
    read(id) { const entry=db.prepare('SELECT * FROM databases WHERE id=?').get(id); if(!entry)throw new Error('Database not found.'); return {...JSON.parse(entry.metadata),revision:String(entry.revision),rows:db.prepare('SELECT payload FROM database_rows WHERE database_id=? ORDER BY position').all(id).map(row=>JSON.parse(row.payload))}; },
    exists(id) { return Boolean(db.prepare('SELECT 1 FROM databases WHERE id=?').get(id)); },
    write(value, expected) {
      const {rows,revision,...metadata}=value;
      if (expected !== undefined) { const result=db.prepare('UPDATE databases SET metadata=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(metadata),value.id,Number(expected)); if(!result.changes)throw new Error('This database changed elsewhere. Reload before saving.'); }
      else db.prepare('INSERT INTO databases(id,metadata) VALUES(?,?)').run(value.id,JSON.stringify(metadata));
      const ids = new Set(); rows.forEach((row,position)=>{ids.add(row.id);putRow.run(value.id,row.id,position,JSON.stringify(row));});
      for(const {id} of db.prepare('SELECT id FROM database_rows WHERE database_id=?').all(value.id))if(!ids.has(id))db.prepare('DELETE FROM database_rows WHERE database_id=? AND id=?').run(value.id,id);
      return database.read(value.id);
    },
  };
  if (!meta.get('migration-complete')) transaction(() => {
    const state = readJson(join(root,'index.json'), { imported:false,items:[] });
    writeState(state);
    const visit = items => items.forEach(item => {
      if (typeof item.id !== 'string' || !/^[\w-]{1,100}$/.test(item.id)) throw new Error('Invalid note ID in migration.');
      if (item.kind === 'note') {
        const file=join(root,'pages',`${item.id}.md`), content=readFileSync(file,'utf8');
        const rich=readJson(file+'.json',null);
        const hash=createHash('sha256').update(content).digest('hex');
        putDoc.run(item.id,content,rich?.hash===hash?JSON.stringify({document:rich.document,html:rich.html}):null);
      }
      visit(item.children || []);
    }); visit(state.items); for(const entry of state.trash || [])visit([entry.item]);
    const folder=join(root,'databases');
    if(existsSync(folder))for(const name of readdirSync(folder).filter(name=>name.endsWith('.json'))){const value=readJson(join(folder,name));database.write(value);}
    for(const name of readdirSync(root).filter(name=>/^history-[\w-]+\.json$/.test(name))){const id=name.slice(8,-5); for(const [order,note]of readJson(join(root,name),[]).entries())db.prepare('INSERT INTO versions(id,revision,created,snapshot) VALUES(?,?,?,?)').run(id,note.revision,order,JSON.stringify(note));}
    putMeta.run('migration-complete','true');
  });
  return {
    db,transaction,readState,writeState,database,
    updatePages(items) { for(const item of items) {const {children,...metadata}=item;db.prepare('UPDATE pages SET metadata=? WHERE id=?').run(JSON.stringify(metadata),item.id);} },
    read(id) { const value=db.prepare('SELECT content,rich FROM documents WHERE id=?').get(id);if(!value)throw new Error('Note not found.'); return {content:value.content,rich:value.rich?JSON.parse(value.rich):{}}; },
    write(id,content) { const current=db.prepare('SELECT rich FROM documents WHERE id=?').get(id);putDoc.run(id,content,current?.rich || null); },
    writeRich(id,value) { db.prepare('UPDATE documents SET rich=? WHERE id=?').run(JSON.stringify(value),id); },
    history(id) { return db.prepare('SELECT snapshot FROM versions WHERE id=? ORDER BY version_id').all(id).map(row=>JSON.parse(row.snapshot)); },
    remember(note) { if(db.prepare('SELECT revision FROM versions WHERE id=? ORDER BY version_id DESC LIMIT 1').get(note.id)?.revision===note.revision)return; const {children,path,...snapshot}=note, body=JSON.stringify(snapshot);if(Buffer.byteLength(body)>8_000_000)return; db.prepare('INSERT INTO versions(id,revision,created,snapshot) VALUES(?,?,?,?)').run(note.id,note.revision,Date.now(),body); const rows=db.prepare('SELECT version_id,length(CAST(snapshot AS BLOB)) AS bytes FROM versions WHERE id=? ORDER BY version_id DESC').all(note.id); let bytes=0; rows.forEach((row,index)=>{bytes+=row.bytes;if(index>=20||bytes>8_000_000)db.prepare('DELETE FROM versions WHERE version_id=?').run(row.version_id);}); },
    close() { db.close(); },
  };
}
