// Button actions only operate on local Notes databases; no code execution or network actions.
export function runDatabaseButton(notes,{id,rowId,propertyId,revision}){
  const database=notes.databaseRow({id,rowId}).database;if(database.revision!==revision)throw new Error('This database changed. Reload before running the button.');
  const row=database.rows.find(r=>r.id===rowId),property=database.properties.find(p=>p.id===propertyId&&p.type==='button');
  if(!row||!property?.actions?.length)throw new Error('Configure this button first.');
  const operations=property.actions.map(action=>{
    if(!['add_row','edit_row'].includes(action.type))throw new Error('Unsupported button action.');
    const target=action.type==='edit_row'?database:notes.databasePage({id:action.databaseId,metadataOnly:true}).database,values={};
    for(const [key,binding] of Object.entries(action.values||{})){
      const p=target.properties.find(p=>p.id===key);if(!p||p.readonly||['formula','rollup','button'].includes(p.type))throw new Error('Invalid action property.');
      if(binding.kind==='property'){if(!database.properties.some(p=>p.id===binding.property))throw new Error('Source property is missing.');values[key]=structuredClone(row.values[binding.property]??null);}
      else if(binding.kind==='now')values[key]=p.type==='date'?{start:new Date().toISOString()}:new Date().toISOString();
      else if(binding.kind==='value')values[key]=binding.value;
      else throw new Error('Invalid action value.');
    }
    return {type:action.type,target,values,templateId:action.templateId};
  });
  for(const operation of operations){if(operation.type==='add_row'){const title=operation.target.properties.find(p=>p.type==='title');notes.databaseAddRow({id:operation.target.id,label:String(operation.values[title.id]||'Untitled'),values:operation.values,templateId:operation.templateId});}else {const current=notes.databasePage({id,metadataOnly:true}).database;notes.databasePatch({id,revision:current.revision,rows:[{id:rowId,values:operation.values}]});}}
  return notes.databaseRow({id,rowId}).database;
}
