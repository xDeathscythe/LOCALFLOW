// Stored views use the row index. Formula/rollup views need the computed query engine.
export function storedPage(storage, request) {
  const metadata = storage.db.prepare('SELECT metadata,revision FROM databases WHERE id=?').get(request.id);
  if (!metadata) throw new Error('Database not found.');
  const database = {...JSON.parse(metadata.metadata),revision:String(metadata.revision),rows:[]};
  if (request.metadataOnly) return {database,rows:[],related:[],total:0,offset:0};
  const view=database.views.find(view=>view.id===request.viewId)||database.views[0];
  if (request.search || request.month || view.filter || view.sorts?.length || view.colors?.length || database.properties.some(property=>['formula','rollup','relation'].includes(property.type)) || ['calendar','timeline'].includes(view.type)) return;
  const total=storage.db.prepare('SELECT count(*) AS count FROM database_rows WHERE database_id=?').get(request.id).count;
  const limit=Math.max(1,Math.min(100,Math.floor(Number(request.limit)||100)));
  const offset=Math.max(0,Math.min(Math.floor(Number(request.offset)||0),Math.max(0,Math.ceil(total/limit)-1)*limit));
  const results=storage.db.prepare('SELECT payload FROM database_rows WHERE database_id=? ORDER BY position LIMIT ? OFFSET ?').all(request.id,limit+2,Math.max(0,offset-1)).map(row=>JSON.parse(row.payload));
  const skip=offset>0?1:0, rows=results.slice(skip,skip+limit), neighbors={};
  rows.forEach((row,index)=>{neighbors[row.id]={before:results[index+skip-1]?.id,after:results[index+skip+1]?.id};});
  return {database:{...database,rows},rows:rows.map(row=>({...row,errors:{}})),related:[],total,offset,viewId:view.id,queryError:'',neighbors};
}
