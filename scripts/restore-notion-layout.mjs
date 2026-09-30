import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,relative,dirname,join,isAbsolute} from 'node:path';
import {parseHTML} from 'linkedom';
import {createHash} from 'node:crypto';

// Restore layout metadata only. Markdown and existing block contents stay untouched.
const [notesRoot,sourceRoot,sourceId,sourceFile,...flags]=process.argv.slice(2);
if(!notesRoot||!sourceFile||!/^[a-f0-9]{32}$/.test(sourceId))throw new Error('Expected notes root, export root, source ID and source HTML.');
const {document}=parseHTML(readFileSync(sourceFile,'utf8'));
const id='notion-'+document.querySelector('article').id.replaceAll('-','');
const indexFile=join(notesRoot,'index.json'),richFile=join(notesRoot,'pages',id+'.md.json');
const index=JSON.parse(readFileSync(indexFile,'utf8')),rich=JSON.parse(readFileSync(richFile,'utf8'));
const find=items=>items.reduce((found,item)=>found||(item.id===id?item:find(item.children||[])),null),page=find(index.items);
if(!page||!rich.document)throw new Error('Expected an existing rich page.');
const markdown=readFileSync(join(notesRoot,'pages',id+'.md'),'utf8');
if(createHash('sha256').update(markdown).digest('hex')!==rich.hash)throw new Error('Rich document revision does not match Markdown.');
const groups=[...document.querySelectorAll('.column-list')].map(group=>[...group.children].filter(child=>child.classList.contains('column')).map(column=>Number(column.getAttribute('data-notion-column-ratio'))*100||parseFloat(column.style.width)));
const columns=[];const visit=node=>{if(node.type==='columns')columns.push(node);for(const child of node.content||[])visit(child);};visit(rich.document);
if(groups.length!==columns.length||groups.some((group,i)=>group.length!==columns[i].content.length||group.some(width=>!Number.isFinite(width)||width<=0||width>100)))throw new Error('Column structure changed; refusing to guess layout.');
for(const [i,group] of columns.entries())for(const [j,column] of group.content.entries())column.attrs={...column.attrs,width:column.attrs?.width??groups[i][j]};
const asset=value=>{if(!value)return '';const file=resolve(dirname(sourceFile),decodeURIComponent(value)),rel=relative(resolve(sourceRoot),file);if(isAbsolute(rel)||rel.split(/[\\/]/).includes('..')||!existsSync(file))throw new Error('Missing or external layout asset.');return `localflow-asset://${sourceId}/${rel.split(/[\\/]/).map(encodeURIComponent).join('/')}`;};
const cover=document.querySelector('.page-cover-image'),icon=document.querySelector('.page-header-icon img');
page.presentation={...page.presentation,wide:true,cover:asset(cover?.getAttribute('src')),icon:asset(icon?.getAttribute('src')),coverPosition:Math.max(0,Math.min(100,parseFloat(cover?.style.objectPosition?.split(' ').at(-1))||50))};
if(flags.includes('--apply')){
 const backup=join(notesRoot,'layout-backups',new Date().toISOString().replaceAll(':','-'));mkdirSync(backup,{recursive:true});copyFileSync(indexFile,join(backup,'index.json'));copyFileSync(richFile,join(backup,id+'.md.json'));
 writeFileSync(richFile,JSON.stringify(rich,null,2));writeFileSync(indexFile,JSON.stringify(index,null,2));console.log('BACKUP',backup);
}
console.log(JSON.stringify({id,applied:flags.includes('--apply'),presentation:page.presentation,columnWidths:groups,markdownUnchanged:true},null,2));
