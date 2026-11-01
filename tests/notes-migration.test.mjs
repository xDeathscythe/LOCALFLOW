import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {openNotesDatabase} from '../host/notes/sqlite-store.mjs';

// Run on a private copy, never the only copy of a user's collection.
const root=resolve(process.argv[2]);
const json=file=>JSON.parse(readFileSync(file,'utf8'));
const state=json(join(root,'index.json'));
const database=openNotesDatabase(root);
let notes=0,databases=0,history=0;
try {
  const normalize=value=>JSON.parse(JSON.stringify(value,(key,value)=>key==='children'&&value?.length===0?undefined:value));
  assert.deepEqual(normalize(database.readState()),normalize(state),'Hierarchy, presentation, trash and workspace metadata survive migration.');
  function visit(items) {
    for(const item of items){
      if(item.kind==='note') {
        const file=join(root,'pages',item.id+'.md'),content=readFileSync(file,'utf8');
        const stored=database.read(item.id); assert.equal(stored.content,content);
        try {
          const rich=json(file+'.json');
          if(rich.hash===createHash('sha256').update(content).digest('hex'))assert.deepEqual(stored.rich,normalize({document:rich.document,html:rich.html}));
        } catch(error){if(error.code!=='ENOENT')throw error;}
        notes++;
      }
      visit(item.children||[]);
    }
  }
  visit(state.items);for(const entry of state.trash||[])visit([entry.item]);
  for(const name of readdirSync(join(root,'databases')).filter(name=>name.endsWith('.json'))) {
    const original=json(join(root,'databases',name)),stored=database.database.read(original.id);
    const {revision:before,...expected}=original,{revision:after,...actual}=stored;
    assert.deepEqual(actual,expected,'Every database property, view and row survives.');databases++;
  }
  for(const name of readdirSync(root).filter(name=>/^history-[\w-]+\.json$/.test(name))) {
    assert.deepEqual(database.history(name.slice(8,-5)),json(join(root,name)));history++;
  }
  assert.equal(database.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  console.log(JSON.stringify({result:'COLLECTION_CONTENT_VERIFIED',notes,databases,history,checks:['complete hierarchy','every Markdown body','valid rich document and HTML','database properties/views/rows','history','SQLite integrity']}));
} finally {database.close();}
