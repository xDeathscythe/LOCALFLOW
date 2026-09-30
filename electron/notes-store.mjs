import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readJsonFile, writeJsonFile } from './niwa/host/niwa-store.mjs';
import { createDatabaseStore, validateDatabase } from './notes/database-store.mjs';
import { runDatabaseButton } from './notes/database-actions.mjs';
import { validatePresentation } from './notes/presentation.mjs';

export function createNotesStore(directory, changed = () => {}) {
  const root = join(directory, 'notes');
  const pages = join(root, 'pages');
  const index = join(root, 'index.json');
  mkdirSync(pages, { recursive: true });
  let state = readJsonFile(index, { imported: false, items: [] });
  const hash = text => createHash('sha256').update(text).digest('hex');
  const find = (id, items = state.items) => items.reduce((found, item) => found || (item.id === id ? item : find(id, item.children || [])), undefined);
  const parentOf = (id, items = state.items) => items.reduce((found, item) => found || (item.children?.some(child => child.id === id) ? item : parentOf(id, item.children || [])), undefined);
  const file = id => { if (!/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid note ID.'); return join(pages, `${id}.md`); };
  const label = value => { if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error('Enter a title of 1–300 characters.'); return value.trim(); };
  const text = value => { if (typeof value !== 'string' || value.length > 2_000_000) throw new Error('Markdown must be at most 2 million characters.'); return value; };
  const write = (id, content) => { const target = file(id), temporary = `${target}.tmp`; writeFileSync(temporary, text(content), 'utf8'); renameSync(temporary, target); };
  const commit = () => { writeJsonFile(index, state); changed(); };
  const databases = createDatabaseStore(root, changed);
  const richFile = id => `${file(id)}.json`;
  const writeRich = (id, content, value) => writeJsonFile(richFile(id), { hash: hash(content), document: value.document || null, html: value.html || null });
  const read = id => {
    const item = find(id);
    if (!item || item.kind !== 'note') throw new Error('Note not found.');
    const content = readFileSync(file(id), 'utf8');
    const rich = readJsonFile(richFile(id), null);
    const validRich = rich?.hash === hash(content) ? { document: rich.document, html: rich.html } : {};
    return { ...item, content, ...validRich, revision: hash(content + '\0' + item.label + '\0' + JSON.stringify(validRich) + '\0' + JSON.stringify(item.presentation)), path: file(id) };
  };
  const list = () => ({ items: structuredClone(state.items), directory: root });
  const rename = (item, title) => {
    item.label = label(title);
    const parent = parentOf(item.id);
    if (parent?.kind === 'database') { const db=databases.read(parent.id), row=db.rows.find(r=>r.pageId===item.id); if(row){row.values[db.properties.find(p=>p.type==='title').id]=item.label;databases.save(db);} }
  };
  return {
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
      state = { imported: true, items: [...state.items, ...save(imported)] }; commit(); return list();
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
      if(parent?.kind==='database'){const db=databases.read(parent.id);db.rows.push({id:item.id,pageId:item.id,values:{[db.properties.find(p=>p.type==='title').id]:item.label}});databases.save(db);}commit();
      return kind === 'note' ? read(item.id) : structuredClone(item);
    },
    save({ id, label: title, content, revision, document, html, presentation }) {
      const current = read(id);
      if (revision !== current.revision) throw new Error('This note changed elsewhere. Your draft is preserved; reload or save it as a new note.');
      const item = find(id), nextLabel = label(title);
      const nextPresentation = presentation === undefined ? item.presentation : validatePresentation(presentation);
      text(content);
      write(id, content); writeRich(id, content, { document, html }); item.presentation = nextPresentation; if(item.label!==nextLabel)rename(item,nextLabel); item.updatedAt = new Date().toISOString(); commit(); return read(id);
    },
    remove(id) {
      if (!find(id)) throw new Error('Note not found.');
      const parent=parentOf(id);
      const remove = items => items.filter(item => item.id !== id).map(item => item.children ? { ...item, children: remove(item.children) } : item);
      writeJsonFile(join(root, `archive-${Date.now()}-${randomUUID()}.json`), state.items);
      if(parent?.kind==='database'){const db=databases.read(parent.id);writeJsonFile(join(root,`archive-database-${Date.now()}-${randomUUID()}.json`),db);db.rows=db.rows.filter(row=>row.pageId!==id);databases.save(db);}
      state.items = remove(state.items); commit(); return list();
    },
    rename({ id, label: title }) { const item = find(id); if (!item) throw new Error('Note not found.'); rename(item,title); commit(); return list(); },
    move({ id, parentId, beforeId }) {
      const item = find(id), parent = parentId ? find(parentId) : null;
      if (!item || (parentId && !parent) || parentId === id || (parentId && find(parentId, item.children || []))) throw new Error('Invalid destination.');
      const oldParent=parentOf(id),destination=parent?(parent.children||[]):state.items;
      if(beforeId&&(beforeId===id||!destination.some(value=>value.id===beforeId)))throw new Error('Invalid position.');
      if(parent?.kind==='database'&&item.kind!=='note')throw new Error('Database children must be pages.');
      if(oldParent?.id!==parent?.id){
        const source=oldParent?.kind==='database'?databases.read(oldParent.id):null,oldRow=source?.rows.find(row=>row.pageId===id);
        if(source)writeJsonFile(join(root,`archive-database-${Date.now()}-${randomUUID()}.json`),source);
        if(parent?.kind==='database'){
          const target=databases.read(parent.id),values={[target.properties.find(p=>p.type==='title').id]:item.label};
          for(const property of target.properties){const from=source?.properties.find(p=>p.name===property.name&&p.type===property.type&&(p.type!=='relation'||p.target===property.target));if(from&&oldRow&&from.id in oldRow.values)values[property.id]=oldRow.values[from.id];}
          target.rows.push({id:item.id,pageId:item.id,values});validateDatabase(target);databases.save(target);
        }
        if(source){source.rows=source.rows.filter(row=>row.pageId!==id);databases.save(source);}
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
      if(parent?.kind==='database'){const db=databases.read(parent.id),old=db.rows.find(row=>row.pageId===id);db.rows.push({id:next.id,pageId:next.id,values:{...(old?.values||{}),[db.properties.find(p=>p.type==='title').id]:next.label}});databases.save(db);}commit();return structuredClone(next);
    },
    databaseRead(id) { if (find(id)?.kind !== 'database') throw new Error('Database not found.'); return databases.read(id); },
    databaseSave(value) { if (find(value.id)?.kind !== 'database') throw new Error('Database not found.'); const title=value.properties.find(p=>p.type==='title'); for(const row of value.rows)if(row.pageId && find(row.pageId))label(row.values[title?.id] || 'Untitled'); const result=databases.save(value); for(const row of result.rows){const page=find(row.pageId);if(page)page.label=String(row.values[title.id] || 'Untitled');}commit();return result; },
    databaseQuery(value) { const related=new Map(); const visit=id=>{if(related.has(id)||find(id)?.kind!=='database')return;const db=databases.read(id);related.set(id,db);db.properties.filter(p=>p.type==='relation'&&p.target).forEach(p=>visit(p.target));};visit(value.id);return databases.query({...value,databases:[...related.values()]}); },
    databaseRunButton(value) { return runDatabaseButton(this,value); },
    databaseAddRow({ id, label: title = 'Untitled', values = {}, templateId }) {
      const template=templateId?read(templateId):{};
      this.databaseRead(id);const page = this.create({ label: title, parentId: id,content:template.content||'',document:template.document,html:template.html }),database=this.databaseRead(id);
      database.rows.find(row=>row.pageId===page.id).values={...values,[database.properties.find(p=>p.type==='title').id]:title};
      return databases.save(database);
    },
    databaseMoveRow({id,rowId,targetId,revision}) {
      const source=this.databaseRead(id),row=source.rows.find(value=>value.id===rowId);this.databaseRead(targetId);
      if(source.revision!==revision)throw new Error('This database changed elsewhere. Reload before moving.');
      if(!row?.pageId||parentOf(row.pageId)?.id!==id||targetId===id)throw new Error('Invalid row or destination.');
      this.move({id:row.pageId,parentId:targetId});return this.databaseRead(id);
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
}
