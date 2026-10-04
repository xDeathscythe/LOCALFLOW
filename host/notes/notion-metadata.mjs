// Optional connector metadata augments the export; original schemas and values remain attached.
const flatten=items=>items.flatMap(item=>[item,...flatten(item.children||[])]);
const idFromUrl=value=>String(value||'').replace(/-/g,'').match(/([a-f0-9]{32})(?:[/?#]|$)/i)?.[1];
const localPage=value=>{const id=idFromUrl(value);return id?`notion-${id}`:value;};
const options=p=>p.options||Object.values(p.groups||{}).flat();
const groupKey={'To-do':'to_do','In progress':'in_progress',Complete:'complete',Future:'future',Current:'current'};
export function enrichNotionBundle(bundle,metadata,{formulas={},rows={},userId}={}){
  const items=flatten(bundle.items), databases=items.filter(item=>item.database), bySource=new Map(), propertyUrls=new Map();
  const warning=(item,message)=>bundle.report.warnings.push(`${item.label}: ${message}`);
  for(const item of databases){const meta=metadata[item.id.slice(7)];if(!meta?.states?.length)continue;for(const state of meta.states)bySource.set(state.url,item.database);item.database.source={...item.database.source,notion:meta};}
  for(const item of databases){const db=item.database,meta=metadata[item.id.slice(7)],state=meta?.states?.[0];if(!state)continue;
    const oldTitle=db.properties.find(p=>p.type==='title');
    for(const [key,source] of Object.entries(state.schema)){
      let property=db.properties.find(p=>p.name===source.name || p.name===key);
      if(!property&&source.type==='title')property=oldTitle;
      if(!property){property={id:`p${db.properties.length}`,name:source.name,type:'text'};db.properties.push(property);}
      const types={file:'files',phone_number:'phone',created_time:'date',last_edited_time:'date',created_by:'person',auto_increment_id:'text',verification:'text'};
      Object.assign(property,{name:source.name,type:types[source.type]||source.type,source});
      if(['created_time','last_edited_time','created_by','auto_increment_id','verification'].includes(source.type))property.readonly=true;
      if(source.type==='button'){property.warning='Notion button actions are not included in the export.';warning(item,`${source.name}: button actions need configuration.`);}
      if(options(source).length)property.options=options(source).map(({name,color})=>({name,color}));
      if(source.codeUrl){property.expression=formulas[source.codeUrl];propertyUrls.set(source.codeUrl.replace('formulaCode:','collectionProperty:'),{db,property});if(!property.expression)warning(item,`${source.name}: formula source unavailable; exported results preserved.`);}
      for(const option of options(source))if(option.url)propertyUrls.set(option.url.replace('collectionPropertyOption:','collectionProperty:').split('/').slice(0,-1).join('/'),{db,property});
      if(source.type==='title')propertyUrls.set(state.url.replace('collection:','collectionProperty:')+'/dGl0bGU',{db,property});
      if(source.type==='relation')property.target=bySource.get(source.dataSourceUrl)?.id || property.target;
    }
  }
  // Two-way relations expose the opposite property's stable URL.
  for(const item of databases)for(const property of item.database.properties){const source=property.source;if(source?.type==='relation'&&source.propertyUrl){const target=bySource.get(source.dataSourceUrl),opposites=target?.properties.filter(p=>p.source?.type==='relation'&&p.source?.dataSourceUrl===item.database.source.notion.states[0].url);if(opposites?.length===1)propertyUrls.set(source.propertyUrl,{db:target,property:opposites[0]});}}
  for(const item of databases){const db=item.database,meta=metadata[item.id.slice(7)],state=meta?.states?.[0];if(!state)continue;
    const prop=key=>db.properties.find(p=>p.name===(state.schema[key]?.name||key));
    for(const property of db.properties)if(property.type==='rollup'){
      const source=property.source,relation=propertyUrls.get(source.relationPropertyUrl)?.property;
      const target=bySource.get(source.targetPropertyUrl?.replace('collectionProperty:','collection:').split('/').slice(0,-1).join('/')) || bySource.get(relation?.source?.dataSourceUrl);
      const relations=db.properties.filter(p=>p.type==='relation'&&p.target===target?.id);
      property.relation=relation?.id || (relations.length===1?relations[0].id:undefined);
      let targetProperty=propertyUrls.get(source.targetPropertyUrl)?.property;
      if(!targetProperty){const candidates=target?.properties.filter(p=>p.source?.type===source.targetPropertyType);if(candidates?.length===1)targetProperty=candidates[0];}
      property.targetProperty=targetProperty?.id;property.aggregation=typeof source.aggregation==='string'?source.aggregation:source.aggregation?.operator || 'show';
      if(source.aggregation?.groupName)property.groupValues=(targetProperty?.source?.groups?.[groupKey[source.aggregation.groupName]]||[]).map(o=>o.name);
      if(!property.relation||(!property.targetProperty&&property.aggregation!=='count'))warning(item,`${property.name}: rollup mapping unavailable; exported results preserved.`);
    }
    const convertFilter=filter=>{
      const p=prop(filter.property);if(!p)return null;
      if(['is_empty','is_not_empty'].includes(filter.operator))return {property:p.id,operator:filter.operator==='is_empty'?'empty':'not_empty'};
      if(filter.operator==='date_is_relative_to')return {property:p.id,operator:'relative_date',value:filter.value};
      const values=(Array.isArray(filter.value)?filter.value:[filter.value]).filter(v=>v&&v.value!==undefined);
      if(!values.length)return null;
      const conditions=values.flatMap(v=>{
        const selected=v.type==='is_group'?(p.source.groups?.[groupKey[v.value]]||[]).map(o=>o.name):[v.value];
        return selected.map(value=>({property:p.id,operator:['relation_contains','person_contains','enum_contains'].includes(filter.operator)?'contains':'is',value:p.type==='relation'?localPage(value):p.type==='person'&&v.type==='relative'&&value==='me'?userId:value}));
      });
      return conditions.length===1?conditions[0]:{operator:'or',filters:conditions};
    };
    db.views=meta.views.map(view=>({id:view.url.slice(7),name:view.name||view.type,type:view.type==='form_editor'?'form':view.type,source:view,visible:view.displayProperties?.map(name=>prop(name)?.id).filter(Boolean),groupBy:prop(view.groupBy?.property)?.id,dateProperty:prop(view.calendarBy||view.timelineBy)?.id,sorts:(view.sorts||[]).map(s=>({property:prop(s.property)?.id,direction:s.direction==='descending'?'desc':'asc'})).filter(s=>s.property),filter:{operator:'and',filters:(view.simpleFilters||[]).map(f=>convertFilter(f.filter)).filter(Boolean)},colors:[]}));
    db.views.push({id:'all',name:'All records',type:'table',sorts:[],colors:[]});
    const sourceRows=rows[item.id.slice(7)]?.results || [],byId=new Map(db.rows.map(row=>[row.id,row]));
    for(const sourceRow of sourceRows){const row=byId.get(localPage(sourceRow.url));if(!row){warning(item,`A source view references a page outside this export: ${idFromUrl(sourceRow.url)}`);continue;}
      for(const [key,source] of Object.entries(state.schema)){const p=prop(key);if(!p)continue;const raw=sourceRow[key];
        if(source.type==='date'&&sourceRow[`date:${key}:start`]!==undefined)row.values[p.id]={start:sourceRow[`date:${key}:start`],end:sourceRow[`date:${key}:end`]||null};
        else if(source.type==='relation'&&raw!==undefined){let values=raw;try{if(typeof raw==='string')values=JSON.parse(raw);}catch{}if(Array.isArray(values))row.values[p.id]=values.map(localPage);}
        else if(source.type==='person'&&raw!==undefined){let values=raw;try{if(typeof raw==='string')values=JSON.parse(raw);}catch{}if(Array.isArray(values)){const existing=Array.isArray(row.values[p.id])?row.values[p.id]:[];row.values[p.id]=values.map((id,i)=>({...existing[i],id,name:existing[i]?.name||id}));}}
        else if(['number','checkbox','text','select','status','url','email','phone_number','created_time','last_edited_time','auto_increment_id'].includes(source.type)&&raw!==undefined)row.values[p.id]=source.type==='checkbox'?raw===true||raw===1||raw==='__YES__':raw;
        // formulaResult:// and rollupResult:// are connector references, never cell values.
      }
    }
  }
  bundle.report.views=databases.reduce((n,item)=>n+item.database.views.length,0);
  bundle.report.formulas=databases.reduce((n,item)=>n+item.database.properties.filter(p=>p.type==='formula'&&p.expression).length,0);
  return bundle;
}
