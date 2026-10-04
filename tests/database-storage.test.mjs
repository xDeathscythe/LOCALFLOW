import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNotesDatabase } from '../host/notes/sqlite-store.mjs';
import { patchDatabase } from '../host/notes/database-patch.mjs';
import { storedPage, storedRow } from '../host/notes/stored-page.mjs';
import { queryRows } from '../host/notes/database-engine.mjs';

const storage=openNotesDatabase(mkdtempSync(join(tmpdir(),'localflow-point-storage-')));
try {
  let database=storage.transaction(()=>storage.database.write({id:'fixture',properties:[{id:'title',name:'名前',type:'title'},{id:'n',name:'عدد',type:'number'}],views:[{id:'table',name:'表',type:'table',sorts:[{property:'n',direction:'asc'}]}],rows:Array.from({length:5000},(_,i)=>({id:'r'+i,pageId:'p'+i,values:{title:i===300?'日本語 العربية ČĆŽ':`Record ${i}`,n:i}}))}));
  const before=storage.db.prepare('SELECT total_changes() AS count').get().count;
  const result=storage.transaction(()=>patchDatabase(storage,{id:database.id,revision:database.revision,rows:[{id:'r300',values:{n:-3}}]},()=>undefined,assert.fail));
  assert(storage.db.prepare('SELECT total_changes() AS count').get().count-before<10,'One cell does not rewrite 5000 rows');
  let page=storage.transaction(()=>storedPage(storage,{id:database.id,search:'čćž',month:'2026-10'}),false);
  assert.equal(page.total,1);assert.equal(page.rows[0].id,'r300');
  assert.equal(storedRow(storage,{id:database.id,pageId:'p300'}).rows.length,1);
  assert.equal(storedPage(storage,{id:database.id}).rows[0].id,'r300');
  // Mixed imported types keep the existing natural comparison instead of coercing text.
  storage.transaction(()=>patchDatabase(storage,{id:database.id,revision:result.revision,rows:[{id:'r301',values:{n:'-2'}}]},()=>undefined,assert.fail));
  database=storage.database.read(database.id);
  assert.deepEqual(storedPage(storage,{id:database.id}).rows.map(row=>row.id),queryRows(database,database.views[0]).slice(0,100).map(row=>row.id));
  const old=storage.database.row(database.id,'r300').row;
  storage.db.prepare('UPDATE database_rows SET payload=? WHERE database_id=? AND id=?').run(JSON.stringify({...old,values:{...old.values,title:'中文 Українська'}}),database.id,old.id);
  assert.equal(storedPage(storage,{id:database.id,search:'українська'}).rows[0].id,'r300','A write from an older client invalidates cached search');
  const sizes=storage.database.sizes(database.id,database.revision);
  storage.database.rememberSizes(database.id,database.revision,49_999_999,sizes.count);
  assert.throws(()=>storage.transaction(()=>patchDatabase(storage,{id:database.id,revision:database.revision,rows:[{id:'r0',values:{title:'A title longer than the original'}}]},()=>undefined,assert.fail)),/too large/);
  assert.equal(storage.database.metadata(database.id).revision,database.revision);assert.equal(storage.database.row(database.id,'r0').row.values.title,'Record 0','Oversized point edit rolls back completely');
  console.log('DATABASE_STORAGE_OK: bounded cell writes, row lookup, Unicode search, numeric index, mixed-type ordering, older-client cache invalidation and size rollback');
} finally {storage.close();}
