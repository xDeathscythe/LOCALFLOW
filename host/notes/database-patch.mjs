import { validateDatabase } from './database-store.mjs';

// A cell edit touches its row, revision and size ledger; schema edits touch their actual scope.
export function patchDatabase(storage, patch, page, rename) {
  const db=storage.db, current=storage.database.metadata(patch.id);
  if(patch.revision!==current.revision)throw new Error('This database changed elsewhere. Reload before saving.');
  const properties=patch.properties||current.properties, views=patch.views||current.views;
  const {revision,rows:ignored,...metadata}=current;
  const next={...metadata,properties,views};
  const inserted=patch.insertRows||[];validateDatabase({...next,rows:inserted});
  for(const row of inserted)if(storage.database.row(patch.id,row.id))throw new Error('Duplicate row ID.');
  const updates=new Map(),removed=new Set(patch.deleteRows||[]);
  if(!Array.isArray(patch.rows||[])||!Array.isArray(patch.deleteRows||[])||(patch.rows||[]).length>50000||removed.size>50000)throw new Error('Invalid row patch.');
  for(const row of patch.rows||[]){if(!row||typeof row.id!=='string'||updates.has(row.id)||!row.values||typeof row.values!=='object'||Array.isArray(row.values))throw new Error('Invalid row patch.');updates.set(row.id,row.values);}
  for(const id of [...updates.keys(),...removed])if(!storage.database.row(patch.id,id))throw new Error('Database row not found.');
  const propertyIds=new Set(properties.map(property=>property.id)),deleted=current.properties.filter(property=>!propertyIds.has(property.id));
  if(patch.copyProperty&&(!current.properties.some(property=>property.id===patch.copyProperty.from)||!propertyIds.has(patch.copyProperty.to)))throw new Error('Invalid copied property.');
  const sizes=storage.database.sizes(patch.id,current.revision),changedPages=[];
  let last=db.prepare('SELECT max(position) AS position FROM database_rows WHERE database_id=?').get(patch.id).position??-1;
  for(const row of inserted){sizes.units+=storage.database.put(patch.id,row,++last);sizes.count++;}
  const apply=entry=>{
    const old=JSON.parse(entry.payload),values={...old.values,...updates.get(old.id)};
    if(patch.copyProperty)values[patch.copyProperty.to]=old.values[patch.copyProperty.from];
    for(const property of deleted)delete values[property.id];
    const row={...old,values},body=JSON.stringify(row);
    const title=properties.find(property=>property.type==='title');
    const linked=page(row.pageId),name=String(values[title.id]||'Untitled');
    if(linked&&linked.label!==name){rename(linked,name);changedPages.push(linked.id);}
    sizes.units+=body.length-entry.payload.length;storage.database.put(patch.id,row,entry.position);
  };
  if(deleted.length||patch.copyProperty||current.properties.find(property=>property.type==='title').id!==properties.find(property=>property.type==='title').id){
    for(const entry of db.prepare('SELECT payload,position FROM database_rows WHERE database_id=? ORDER BY position').iterate(patch.id))if(!removed.has(JSON.parse(entry.payload).id))apply(entry);
  }else for(const id of updates.keys())if(!removed.has(id)){const entry=storage.database.row(patch.id,id);apply({payload:JSON.stringify(entry.row),position:entry.position});}
  for(const id of removed){const entry=storage.database.row(patch.id,id);sizes.units-=entry.units;sizes.count--;db.prepare('DELETE FROM database_rows WHERE database_id=? AND id=?').run(patch.id,id);}
  if(patch.reorder){
    const moved=storage.database.row(patch.id,patch.reorder.id),before=storage.database.row(patch.id,patch.reorder.beforeId);
    if(!moved||!before||patch.reorder.id===patch.reorder.beforeId)throw new Error('Invalid row order.');
    const previous=db.prepare('SELECT position FROM database_rows WHERE database_id=? AND id!=? AND position<? ORDER BY position DESC LIMIT 1').get(patch.id,patch.reorder.id,before.position)?.position;
    let position=previous===undefined?before.position-1:(previous+before.position)/2;
    if(position===previous||position===before.position){
      db.prepare('WITH ranks AS (SELECT id,row_number() OVER (ORDER BY position)-1 AS rank FROM database_rows WHERE database_id=?) UPDATE database_rows SET position=(SELECT rank FROM ranks WHERE ranks.id=database_rows.id) WHERE database_id=?').run(patch.id,patch.id);
      const target=storage.database.row(patch.id,patch.reorder.beforeId).position;
      position=target-0.5;
    }
    db.prepare('UPDATE database_rows SET position=? WHERE database_id=? AND id=?').run(position,patch.id,patch.reorder.id);
  }
  if(sizes.count>50000||JSON.stringify({...next,rows:[]}).length+sizes.units+Math.max(0,sizes.count-1)>50_000_000)throw new Error('Database is too large.');
  const result=db.prepare('UPDATE databases SET metadata=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(next),patch.id,Number(current.revision));
  if(!result.changes)throw new Error('This database changed elsewhere. Reload before saving.');
  const updated=String(Number(current.revision)+1);storage.database.rememberSizes(patch.id,updated,sizes.units,sizes.count);
  if(patch.views||patch.properties)storage.database.ensureSortIndexes(next);
  return {revision:updated,changedPages};
}
