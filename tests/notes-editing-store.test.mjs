import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createNotesStore} from '../electron/notes-store.mjs';
import {storeUploads} from '../electron/notes/uploads.mjs';
import {resolveAsset} from '../electron/notes/notion-import.mjs';
const root=mkdtempSync(join(tmpdir(),'localflow-edit-store-'));
try{
 const notes=createNotesStore(root),a=notes.create({kind:'database',label:'日本語'}),b=notes.create({kind:'database',label:'العربية'});
 const page=notes.create({label:'Row page',parentId:a.id,content:'Original body'});assert.equal(notes.databaseRead(a.id).rows.length,1);
 const child=notes.create({label:'Child',parentId:page.id,content:'Nested content'});
 const clone=notes.duplicate({id:a.id});assert.equal(notes.databaseRead(clone.id).rows.length,1);assert.equal(notes.read(clone.children[0].id).content,'Original body');assert.notEqual(clone.children[0].children[0].id,child.id);assert.equal(notes.databaseRead(clone.id).rows[0].pageId,clone.children[0].id);
 const old=notes.databaseRead(a.id);notes.databaseMoveRow({id:a.id,rowId:page.id,targetId:b.id,revision:old.revision});assert.equal(notes.databaseRead(a.id).rows.length,0);assert.equal(notes.databaseRead(b.id).rows.length,1);assert.equal(notes.read(page.id).content,'Original body');
 assert.throws(()=>notes.databaseMoveRow({id:a.id,rowId:page.id,targetId:b.id,revision:old.revision}),/changed elsewhere/);
 notes.remove(page.id);assert.equal(notes.databaseRead(b.id).rows.length,0);assert.throws(()=>notes.read(child.id),/not found/);
 const c=notes.create({label:'Order 1'}),d=notes.create({label:'Order 2'});notes.move({id:d.id,beforeId:c.id});const ids=notes.list().items.map(n=>n.id);assert(ids.indexOf(d.id)<ids.indexOf(c.id));
 const beforeDesign=notes.read(c.id),designed=notes.save({...beforeDesign,presentation:{iconText:'🌿',cover:'https://example.com/cover.png',coverPosition:25}});
 assert.equal(createNotesStore(root).read(c.id).presentation.iconText,'🌿');assert.equal(designed.presentation.coverPosition,25);
 assert.throws(()=>notes.save({...beforeDesign,presentation:{iconText:'📚'}}),/changed elsewhere/);
 assert.throws(()=>notes.save({...designed,presentation:{cover:'javascript:alert(1)'}}),/Invalid page image/);
 assert.equal(notes.read(c.id).presentation.coverPosition,25);
 notes.databaseAddRow({id:b.id,label:'Only one row'});assert.equal(notes.databaseRead(b.id).rows.length,1);
 const db=notes.databaseRead(b.id);db.views[0].widths={title:200};db.views[0].order=['title'];db.views[0].wrap=true;notes.databaseSave(db);assert.equal(createNotesStore(root).databaseRead(b.id).views[0].widths.title,200);
 const files=await storeUploads(join(root,'notes'),[{name:'../日本語 image.png',data:new Uint8Array([1,2,3])}]);assert.equal(files[0].name,'日本語 image.png');assert.equal(files[0].mime,'image/png');assert.deepEqual([...readFileSync(resolveAsset(join(root,'notes'),files[0].url))],[1,2,3]);await assert.rejects(()=>storeUploads(root,[{name:'bad',data:'bad'}]),/Invalid file/);
 console.log('NOTES_EDITING_STORE_OK: duplicate tree, linked database row create/move/delete, order, durable widths, uploads');
}finally{rmSync(root,{recursive:true,force:true});}
