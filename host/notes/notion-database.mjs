export function parseCsv(text) {
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) { const c=text[i]; if(c==='"') { if(quoted && text[i+1]==='"') { field+='"';i++; } else quoted=!quoted; } else if(c===',' && !quoted) { row.push(field);field=''; } else if((c==='\r' || c==='\n') && !quoted) { if(c==='\r' && text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field=''; } else field+=c; }
  if(quoted)throw new Error('Unclosed CSV field.');
  if(field || row.length) { row.push(field);rows.push(row); }
  if(rows[0]?.[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,'');
  return rows;
}
export function readRowProperties(document, link) {
  return [...document.querySelectorAll('table.properties tr')].map(tr=>{
    const name=tr.querySelector('th')?.textContent, cell=tr.querySelector('td');
    const type=[...tr.classList].find(c=>c.startsWith('property-row-'))?.slice(13) || 'text';
    let value=cell?.textContent.trim() || '';
    if(type==='date') { const dates=[...cell.querySelectorAll('time')].map(t=>t.getAttribute('datetime'));value={ start:dates[0] || null,end:dates[1] || null }; }
    if(type==='number')value=value===''?null:Number(value.replace(/[\p{Sc}\s,]/gu,''));
    if(type==='checkbox')value=!!cell.querySelector('.checkbox-on');
    if(type==='multi_select')value=[...cell.querySelectorAll('.selected-value')].map(v=>v.textContent.trim());
    if(type==='relation')value=[...cell.querySelectorAll('a')].map(a=>{const id=a.getAttribute('data-notion-page-id')?.replace(/-/g,'');return id ? `notion-${id}` : link(a.getAttribute('href'));});
    if(type==='person')value=[...cell.querySelectorAll('.user')].map(user=>{const copy=user.cloneNode(true);copy.querySelector('.icon')?.remove();return {name:copy.textContent.trim()};});
    if(type==='files')value=[...cell.querySelectorAll('a')].map(a=>({name:a.textContent.trim(),url:link(a.getAttribute('href'))}));
    return {name,type,value};
  }).filter(p=>p.name);
}

export function databaseFromExport(item,csv,children) {
  const [headers=[],...entries]=parseCsv(csv), properties=headers.map((name,i)=>({id:`p${i}`,name:name || `Column ${i+1}`,type:i===0?'title':'text'}));
  if(!properties.length)properties.push({id:'title',name:'Name',type:'title'});
  for(const child of children)for(const p of child.rowProperties || []) {
    let property=properties.find(v=>v.name===p.name);if(!property){property={id:`p${properties.length}`,name:p.name,type:'text'};properties.push(property);}
    if(property.type!=='title')property.type=['number','checkbox','date','select','status','multi_select','relation','person','files','url','email','phone'].includes(p.type)?p.type:'text';
    property.source={type:p.type};
  }
  const rows=children.map(child=>({id:child.id,pageId:child.id,values:Object.fromEntries(properties.map(p=>[p.id,p.type==='title'?(child.rowTitle ?? child.label):child.rowProperties?.find(v=>v.name===p.name)?.value ?? null]))}));
  // HTML row pages have stable IDs and all properties; CSV is a second view of those same records.
  if(!children.length)for(const [index,entry] of entries.entries())rows.push({id:`${item.id}-csv-${index}`,values:Object.fromEntries(properties.map((p,i)=>[p.id,entry[i] || '']))});
  if(children.length && entries.length>children.length)throw new Error(`Exported database has CSV rows without pages: ${item.label}`);
  for(const p of properties)if(['select','status','multi_select'].includes(p.type))p.options=[...new Set(rows.flatMap(row=>Array.isArray(row.values[p.id])?row.values[p.id]:[row.values[p.id]]).filter(Boolean))].map(name=>({name:String(name)}));
  return { id:item.id,properties,rows,views:[{id:'all',name:'All',type:'table',sorts:[],colors:[]}],source:{format:'notion-html-csv'} };
}
