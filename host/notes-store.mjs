import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { writeJsonFile } from './niwa/host/niwa-store.mjs';
import { createDatabaseStore, validateDatabase } from './notes/database-store.mjs';
import { runDatabaseButton } from './notes/database-actions.mjs';
import { databasePageAction, databaseExport } from './notes/database-page.mjs';
import { displayValue } from './notes/database-engine.mjs';
import { patchDatabase } from './notes/database-patch.mjs';
import { openNotesDatabase } from './notes/sqlite-store.mjs';
import { storedPage, storedRow } from './notes/stored-page.mjs';
import { validatePresentation } from './notes/presentation.mjs';

export function createNotesStore(directory, changed = () => {}) {
  const root = join(directory, 'notes');
  const pages = join(root, 'pages');
  mkdirSync(pages, { recursive: true });
  const storage = openNotesDatabase(root);
  let state = storage.readState();
  let byId = new Map(), parents = new Map(), events = [];
  const indexTree = () => { byId = new Map(); parents = new Map(); const visit=(items,parent)=>items.forEach(item=>{byId.set(item.id,item);if(parent)parents.set(item.id,parent);visit(item.children||[],item);});visit(state.items); };
  indexTree();
  const find = (id, items) => items ? items.reduce((found,item)=>found||(item.id===id?item:find(id,item.children||[])),undefined) : byId.get(id);
  const parentOf = id => parents.get(id);
  const file = id => { if (!/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid note ID.'); return join(pages, `${id}.md`); };
  const label = value => { if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error('Enter a title of 1–300 characters.'); return value.trim(); };
  const text = value => { if (typeof value !== 'string' || value.length > 2_000_000) throw new Error('Markdown must be at most 2 million characters.'); return value; };
  const write = (id, content) => { file(id); storage.write(id,text(content)); };
  const commit = (ids = [], tree = true, treeEvent = tree) => { if(tree){indexTree();storage.writeState(state,ids,true);}else storage.updatePages(ids.map(id=>find(id)).filter(Boolean));events.push({ids,tree:treeEvent}); };
  const databases = createDatabaseStore(root, change=>events.push(change), storage);
  const writeRich = (id, content, value, serialized) => storage.writeRich(id, { document: value.document || null, html: value.html || null },serialized);
  const snapshot = (item, content, rich, serialized = JSON.stringify(rich)) => ({ ...item, content, ...rich, revision: createHash('sha256').update(content).update('\0').update(item.label).update('\0').update(serialized).update('\0').update(String(JSON.stringify(item.presentation))).digest('hex'), path: join(root,'workspace.sqlite') });
  const read = id => {
    const item = find(id);
    if (!item || item.kind !== 'note') throw new Error('Note not found.');
    const {content,rich,serialized} = storage.read(id);
    return snapshot(item, content, rich,serialized);
  };
  const versions = {read:storage.history,remember:storage.remember};
  const assertUnlocked = item => { if (item?.presentation?.locked) throw new Error('Unlock this page before editing.'); };
  const list = () => ({ items: structuredClone(state.items), directory: root });
  const rename = (item, title) => {
    item.label = label(title);
    const parent = parentOf(item.id);
    if (parent?.kind === 'database') { const db=storage.database.metadata(parent.id),row=storage.database.rows(parent.id,[item.id])[0];if(row)methods.databasePatch({id:parent.id,revision:db.revision,rows:[{id:row.id,values:{[db.properties.find(p=>p.type==='title').id]:item.label}}]}); }
  };
  const methods = {
    list, read,
    importLegacy(items) {
      if (state.imported) return list();
      const ids = new Set();
      const convert = (items, depth = 0) => {
        if (!Array.isArray(items) || depth > 40 || items.length > 10000) throw new Error('Invalid notes tree.');
        return items.map(item => {
          file(item.id); if (ids.has(item.id)) throw new Error('Duplicate note ID.'); ids.add(item.id);
          const base = { id: find(item.id) ? randomUUID() : item.id, label: label(item.label), kind: item.kind };
          if (item.kind === 'folder') return { ...base, children: convert(item.children, depth + 1) };
          if (item.kind !== 'note') throw new Error('Invalid note kind.');
          text(item.content);
          return { ...base, content: item.content, updatedAt: item.updatedAt || new Date().toISOString() };
        });
      };
      const imported = convert(items);
      // Preserve the original browser export even after migration.
      if (!existsSync(join(root, 'legacy-backup.json'))) writeJsonFile(join(root, 'legacy-backup.json'), imported);
      const save = items => items.map(item => {
        if (item.kind === 'folder') return { ...item, children: save(item.children) };
        const { content, ...metadata } = item; write(item.id, content); return metadata;
      });
      state = { ...state, imported: true, items: [...state.items, ...save(imported)] }; commit(); return list();
    },
    create({ kind = 'note', label: title, parentId, content = '', document, html }) {
      if (!['folder', 'note', 'database'].includes(kind)) throw new Error('Invalid note kind.');
      const parent = parentId ? find(parentId) : null;
      if (parentId && !parent) throw new Error('Choose a notes folder or page.');
      if (parent?.kind === 'database' && kind !== 'note') throw new Error('Database children must be pages.');
      const item = { id: randomUUID(), kind, label: label(title), children: [], updatedAt: new Date().toISOString() };
      if (kind === 'note') { write(item.id, content); writeRich(item.id, content, { document, html }); }
      if (kind === 'database') databases.create(item.id);
      (parent ? (parent.children ||= []) : state.items).push(item);
      if(parent?.kind==='database'){const db=storage.database.metadata(parent.id);methods.databasePatch({id:parent.id,revision:db.revision,insertRows:[{id:item.id,pageId:item.id,values:{[db.properties.find(p=>p.type==='title').id]:item.label}}]});}commit();
      return kind === 'note' ? read(item.id) : structuredClone(item);
    },
    save({ id, label: title, content, revision, document, html, presentation }) {
      const current = read(id);
      if (revision !== current.revision) throw new Error('This note changed elsewhere. Your draft is preserved; reload or save it as a new note.');
      const item = find(id), nextLabel = label(title);
      const nextPresentation = presentation === undefined ? item.presentation : validatePresentation(presentation);
      text(content);
      const treeChanged = item.label !== nextLabel || JSON.stringify(item.presentation) !== JSON.stringify(nextPresentation);
      const rich = { document: document || null, html: html || null };
      const contentChanged = content !== current.content;
      const serialized = JSON.stringify(rich), richChanged = serialized !== storage.richJson(id);
      if (!treeChanged && !contentChanged && !richChanged) return current;
      if (current.presentation?.locked && (contentChanged || richChanged || nextLabel !== current.label || nextPresentation?.locked !== false || JSON.stringify({...nextPresentation,locked:true}) !== JSON.stringify({...current.presentation,locked:true}))) throw new Error('Unlock this page before editing.');
      versions.remember(current);
      if (contentChanged) write(id, content);
      if (contentChanged || richChanged) writeRich(id, content, rich,serialized);
      item.presentation = nextPresentation; if(item.label!==nextLabel)rename(item,nextLabel); item.updatedAt = new Date().toISOString(); commit([id], false,treeChanged); return snapshot(item, content, rich,serialized);
    },
    trash() { return (state.trash || []).map(({item, deletedAt}) => ({id:item.id,label:item.label,kind:item.kind,deletedAt})); },
    restore(id) {
      const entry = state.trash?.find(value => value.item.id === id);
      if (!entry || find(id)) throw new Error('Page not found in trash.');
      const parent = entry.parentId ? find(entry.parentId) : null;
      if (parent?.kind === 'database') {
        const db = storage.database.metadata(parent.id);
        methods.databasePatch({id:parent.id,revision:db.revision,insertRows:[entry.row || {id,pageId:id,values:{[db.properties.find(p=>p.type==='title').id]:entry.item.label}}]});
      }
      (parent ? (parent.children ||= []) : state.items).push(entry.item);
      state.trash = state.trash.filter(value => value !== entry); commit(); return list();
    },
    history(id) { read(id); return versions.read(id).map(({revision,label,updatedAt,content}) => ({revision,label,updatedAt,preview:content.slice(0,300)})).reverse(); },
    restoreVersion({id, revision}) {
      const current = read(id); assertUnlocked(current);
      const version = versions.read(id).find(value => value.revision === revision);
      if (!version) throw new Error('Page version not found.');
      return this.save({...version,id,presentation:version.presentation||{},revision:current.revision});
    },
    remove(id) {
      const item = find(id); if (!item) throw new Error('Note not found.');
      const parent = parentOf(id), db = parent?.kind === 'database' ? storage.database.metadata(parent.id) : null;
      const row=db?storage.database.rows(db.id,[id])[0]:undefined;
      const entry = {item:structuredClone(item),parentId:parent?.id,deletedAt:new Date().toISOString(),row};
      state.trash ||= []; state.trash.push(entry);
      if (db&&row) methods.databasePatch({id:db.id,revision:db.revision,deleteRows:[row.id]});
      const detach = items => { const at=items.findIndex(value=>value.id===id); if(at>=0) items.splice(at,1); else items.forEach(value=>detach(value.children||[])); };
      detach(state.items); commit(); return list();
    },
    rename({ id, label: title }) { const item = find(id); if (!item) throw new Error('Note not found.'); assertUnlocked(item); rename(item,title); commit([id],false,true); return list(); },
    move({ id, parentId, beforeId }) {
      const item = find(id), parent = parentId ? find(parentId) : null;
      if (!item || (parentId && !parent) || parentId === id || (parentId && find(parentId, item.children || []))) throw new Error('Invalid destination.');
      const oldParent=parentOf(id),destination=parent?(parent.children||[]):state.items;
      if(beforeId&&(beforeId===id||!destination.some(value=>value.id===beforeId)))throw new Error('Invalid position.');
      if(parent?.kind==='database'&&item.kind!=='note')throw new Error('Database children must be pages.');
      if(oldParent?.id!==parent?.id){
        const source=oldParent?.kind==='database'?storage.database.metadata(oldParent.id):null,oldRow=source?storage.database.rows(source.id,[id])[0]:undefined;
        if(source&&oldRow)writeJsonFile(join(root,`archive-database-${Date.now()}-${randomUUID()}.json`),{...source,rows:[oldRow]});
        if(parent?.kind==='database'){
          const target=storage.database.metadata(parent.id),values={[target.properties.find(p=>p.type==='title').id]:item.label};
          for(const property of target.properties){const from=source?.properties.find(p=>p.name===property.name&&p.type===property.type&&(p.type!=='relation'||p.target===property.target));if(from&&oldRow&&from.id in oldRow.values)values[property.id]=oldRow.values[from.id];}
          methods.databasePatch({id:target.id,revision:target.revision,insertRows:[{id:item.id,pageId:item.id,values}]});
        }
        if(source&&oldRow)methods.databasePatch({id:source.id,revision:source.revision,deleteRows:[oldRow.id]});
      }
      const detach = items => { const at = items.findIndex(value => value.id === id); if (at >= 0) items.splice(at, 1); else items.forEach(value => detach(value.children || [])); };
      detach(state.items); const target=parent?(parent.children||=[]):state.items;target.splice(beforeId?target.findIndex(value=>value.id===beforeId):target.length,0,item);commit(); return list();
    },
    duplicate({id,parentId}) {
      const source=find(id),parent=parentId===undefined?parentOf(id):parentId?find(parentId):null;
      if(!source||(parentId&&!parent))throw new Error('Invalid page or destination.');
      if(parent?.kind==='database'&&source.kind!=='note')throw new Error('Database children must be pages.');
      const ids=new Map(),allocate=item=>{ids.set(item.id,randomUUID());(item.children||[]).forEach(allocate);};allocate(source);
      const remap=value=>typeof value==='string'?(ids.get(value)||value.replace(/localflow-note:\/\/([\w-]+)/g,(full,id)=>ids.has(id)?`localflow-note://${ids.get(id)}`:full)):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,remap(item)])):value;
      const copy=item=>{const next={...structuredClone(item),id:ids.get(item.id),children:(item.children||[]).map(copy),updatedAt:new Date().toISOString()};if(item.id===id)next.label=`${item.label.slice(0,293)} (copy)`;
        if(item.kind==='note'){const old=read(item.id),content=remap(old.content);write(next.id,content);writeRich(next.id,content,{document:remap(old.document),html:remap(old.html)});}
        if(item.kind==='database'){const {revision,...db}=databases.read(item.id);databases.create(next.id,remap(db));}return next;};
      const next=copy(source);(parent?(parent.children||=[]):state.items).push(next);
      if(parent?.kind==='database'){const db=storage.database.metadata(parent.id),old=storage.database.rows(parent.id,[id])[0];this.databasePatch({id:parent.id,revision:db.revision,insertRows:[{id:next.id,pageId:next.id,values:{...(old?.values||{}),[db.properties.find(p=>p.type==='title').id]:next.label}}]});}commit();return structuredClone(next);
    },
    databaseRead(id) { if (find(id)?.kind !== 'database') throw new Error('Database not found.'); return databases.read(id); },
    databasePage(value) { if(find(value.id)?.kind!=='database')throw new Error('Database not found.'); return storedPage(storage,value); },
    databaseRow(value) { if(find(value.id)?.kind!=='database')throw new Error('Database not found.'); return storedRow(storage,value); },
    databasePatch(value) { if(find(value.id)?.kind!=='database')throw new Error('Database not found.');const {revision,changedPages}=patchDatabase(storage,value,find,(page,name)=>{label(name);assertUnlocked(page);page.label=name;});if(changedPages.length)commit(changedPages,false,true);events.push({ids:[value.id,...changedPages],tree:false});return {revision}; },
    databasePageAction(value) { return databasePageAction(this, value); },
    databaseOptions(id) { const database=storage.database.metadata(id),title=database.properties.find(property=>property.type==='title').id;return storage.db.prepare("SELECT id,json_extract(payload,'$.pageId') AS pageId,json_extract(payload,?) AS title FROM database_rows WHERE database_id=? ORDER BY position").all(`$.values.${JSON.stringify(title)}`,id).map(row=>({value:row.pageId||row.id,label:displayValue(row.title)||'Untitled'})); },
    databaseExport(value) { return databaseExport(this, value); },
    databaseSave(value) {
      if (find(value.id)?.kind !== 'database') throw new Error('Database not found.');
      const pages = new Map(), collect = items => { for (const item of items) { pages.set(item.id, item); collect(item.children || []); } }; collect(state.items);
      const title = value.properties.find(p => p.type === 'title');
      for (const row of value.rows) if (pages.has(row.pageId)) { label(row.values[title?.id] || 'Untitled'); if (pages.get(row.pageId).label !== String(row.values[title?.id] || 'Untitled')) assertUnlocked(pages.get(row.pageId)); }
      const result = databases.save(value), changedPages = [];
      for (const row of result.rows) { const page = pages.get(row.pageId), name = String(row.values[title.id] || 'Untitled'); if (page && page.label !== name) { assertUnlocked(page); page.label = name; changedPages.push(page.id); } }
      if (changedPages.length) commit([value.id, ...changedPages]);
      return result;
    },
    databaseQuery(value) { const related=new Map(); const visit=id=>{if(related.has(id)||find(id)?.kind!=='database')return;const db=databases.read(id);related.set(id,db);db.properties.filter(p=>p.type==='relation'&&p.target).forEach(p=>visit(p.target));};visit(value.id);return databases.query({...value,databases:[...related.values()]}); },
    databaseRunButton(value) { return runDatabaseButton(this,value); },
    databaseAddRow({ id, label: title = 'Untitled', values = {}, templateId }) {
      const template=templateId?read(templateId):{};
      const page = this.create({ label: title, parentId: id,content:template.content||'',document:template.document,html:template.html }),database=storage.database.metadata(id);
      this.databasePatch({id,revision:database.revision,rows:[{id:page.id,values:{...values,[database.properties.find(p=>p.type==='title').id]:title}}]});
      return this.databaseRow({id,pageId:page.id}).database;
    },
    databaseMoveRow({id,rowId,targetId,revision}) {
      const source=storage.database.metadata(id),row=storage.database.row(id,rowId)?.row;storage.database.metadata(targetId);
      if(source.revision!==revision)throw new Error('This database changed elsewhere. Reload before moving.');
      if(!row?.pageId||parentOf(row.pageId)?.id!==id||targetId===id)throw new Error('Invalid row or destination.');
      this.move({id:row.pageId,parentId:targetId});return storage.database.metadata(id);
    },
    importBundle(bundle) {
      if (!bundle || !Array.isArray(bundle.items) || !bundle.sourceId) throw new Error('Invalid import.');
      if (state.imports?.[bundle.sourceId]) return { ...list(), alreadyImported: true };
      const ids = new Set(), validate = (items,depth=0) => { if(!Array.isArray(items) || depth>100 || ids.size>50000)throw new Error('Import tree is too large or deep.'); for (const item of items) { file(item.id); if (ids.has(item.id) || find(item.id)) throw new Error('Duplicate import ID.'); ids.add(item.id); label(item.label); if (!['note','folder','database'].includes(item.kind)) throw new Error('Invalid import kind.'); if (item.kind === 'note') text(item.content || ''); validate(item.children || [],depth+1); } };
      validate(bundle.items);
      const preflight=items=>items.forEach(item=>{if(item.kind==='database')validateDatabase(item.database);preflight(item.children||[]);});preflight(bundle.items);
      writeJsonFile(join(root, `before-import-${Date.now()}.json`), state);
      const save = items => items.map(item => {
        const { content, document, html, database, ...metadata } = item;
        if (item.kind === 'note') { write(item.id, content || ''); writeRich(item.id, content || '', { document, html }); }
        if (item.kind === 'database') databases.create(item.id, database);
        return { ...metadata, children: save(item.children || []) };
      });
      state.items.push(...save(bundle.items)); state.imports ||= {}; state.imports[bundle.sourceId] = new Date().toISOString(); commit(); return list();
    },
  };
  const reads = new Set(['list','read','trash','history','databaseRead','databasePage','databaseRow','databaseOptions','databaseExport','databaseQuery']);
  return { ...Object.fromEntries(Object.entries(methods).map(([name,method]) => [name, (...args) => {
    if (reads.has(name)) return storage.transaction(() => method.apply(methods,args),false);
    try { const value=storage.transaction(() => method.apply(methods,args)); for(const event of events)changed(event);events=[];return value; }
    catch(error) { events=[];state=storage.readState();indexTree();throw error; }
  }])), close:storage.close };
}
