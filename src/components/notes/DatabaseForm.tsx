import { useState } from 'react';
import type { NotesDatabase, Property } from '../../lib/database';
import { DatabaseCell } from './DatabaseCell';
export function DatabaseForm({database,databases,properties,submitted}:{database:NotesDatabase;databases:NotesDatabase[];properties:Property[];submitted:(database:NotesDatabase)=>void}){
  const [values,setValues]=useState<Record<string,unknown>>({}),[pending,setPending]=useState(false),[status,setStatus]=useState('');
  const title=database.properties.find(p=>p.type==='title')!;
  return <form className="databaseForm" onSubmit={async e=>{e.preventDefault();setPending(true);setStatus('');try{submitted(await window.localflow.notesDatabaseAddRow({id:database.id,label:String(values[title.id]||'Untitled'),values}));setValues({});setStatus('Saved');}catch(error){setStatus(String(error));}finally{setPending(false);}}}>{properties.filter(p=>!p.readonly&&!['formula','rollup','button'].includes(p.type)).map(p=><label key={p.id}><span>{p.name}</span><DatabaseCell property={p} value={values[p.id]} databases={databases} disabled={pending} save={value=>setValues(current=>({...current,[p.id]:value}))}/></label>)}<button disabled={pending}>Create page</button><span role="status">{status}</span></form>;
}
