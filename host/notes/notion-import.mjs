import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { databaseFromExport, readRowProperties } from './notion-database.mjs';
export { resolveAsset } from './asset-path.cjs';

const pageId = name => name.match(/(?:^|[ /])([a-f0-9]{32})(?=\.|$|\/)/i)?.[1]?.toLowerCase();
export function exportedPage(byId, filename) {
  const full = pageId(basename(filename));
  if (full) return byId.get(full);
  const short = basename(filename).match(/\s([a-f0-9]{4,})-([a-f0-9]{4,})\.csv$/i);
  if (!short) return undefined;
  const matches = [...byId].filter(([id]) => id.startsWith(short[1].toLowerCase()) && id.endsWith(short[2].toLowerCase()));
  return matches.length === 1 ? matches[0][1] : undefined;
}
const key = value => createHash('sha256').update(value).digest('hex').slice(0,32);
const localId = id => `notion-${id}`;
const walk = root => readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(root, entry.name)) : entry.isFile() ? [join(root, entry.name)] : []);
const inside = (root, file) => { const rel = relative(root, file); return rel && !isAbsolute(rel) && !rel.split(sep).includes('..'); };

// Preserve structural HTML alongside readable Markdown. Original exports are kept intact.
export function htmlToMarkdown(node) {
  if (node.nodeType === 3) return node.textContent.replace(/([\\`*_[\]])/g, '\\$1');
  if (node.nodeType !== 1) return '';
  const tag = node.localName, children = () => [...node.childNodes].map(htmlToMarkdown).join('');
  if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${children()}\n\n`;
  if (['strong','b'].includes(tag)) return `**${children()}**`;
  if (['em','i'].includes(tag)) return `*${children()}*`;
  if (['s','del'].includes(tag)) return `~~${children()}~~`;
  if (tag === 'br') return '\n';
  if (tag === 'hr') return '\n\n---\n\n';
  if (tag === 'a') return `[${children()}](${(node.getAttribute('href') || '').replace(/\)/g,'%29')})`;
  if (tag === 'img') return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`;
  if (tag === 'pre') { const text = node.textContent; const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m=>m[0].length+1))); return `\n\n${fence}\n${text}\n${fence}\n\n`; }
  if (tag === 'code') return `\`${node.textContent.replace(/`/g,'\\`')}\``;
  if (tag === 'blockquote') return `\n\n${children().trim().replace(/^/gm,'> ')}\n\n`;
  if (tag === 'li') { const todo = node.getAttribute('data-checked'); const prefix = todo !== null ? `- [${todo === 'true' ? 'x' : ' '}]` : node.parentElement?.localName === 'ol' ? `${[...node.parentElement.children].indexOf(node)+1}.` : '-'; return `\n${prefix} ${children().trim().replace(/\n/g,'\n  ')}\n`; }
  if (tag === 'table') { const rows = [...node.querySelectorAll('tr')].map(row => [...row.children].map(cell => htmlToMarkdown(cell).trim().replace(/\|/g,'\\|').replace(/\n/g,'<br>'))); if (!rows.length) return ''; return '\n\n' + [rows[0], rows[0].map(()=>'---'), ...rows.slice(1)].map(row=>`| ${row.join(' | ')} |`).join('\n') + '\n\n'; }
  if (['details','aside'].includes(tag) || node.getAttribute('data-type') === 'columns') return `\n\n${node.outerHTML}\n\n`;
  if (['p','div','section','ul','ol','figure'].includes(tag)) return `\n\n${children()}\n\n`;
  return children();
}

function cleanHtml(root, convertLink, report) {
  const document=root.ownerDocument||root;
  for (const element of [...root.querySelectorAll('script,style,link,meta,object,form,input,button')]) element.remove();
  for (const element of [...root.querySelectorAll('iframe,video,audio,embed')]) {
    const anchor = document.createElement('a'); anchor.setAttribute('data-type','attachment'); anchor.textContent = element.getAttribute('title') || element.getAttribute('src') || element.textContent || 'Media'; anchor.setAttribute('href',element.getAttribute('src') || element.querySelector('source')?.getAttribute('src') || ''); element.replaceWith(anchor); report.mediaLinks++;
  }
  for (const element of root.querySelectorAll('*')) {
    if (element.classList.contains('column-list')) element.setAttribute('data-type','columns');
    if (element.classList.contains('column')) {
      element.setAttribute('data-type','column');
      const width=Number(element.getAttribute('data-notion-column-ratio'))*100 || parseFloat(element.style.width);
      if(Number.isFinite(width)&&width>0&&width<=100)element.setAttribute('data-column-width',String(width));
    }
    if (element.classList.contains('callout')) element.setAttribute('data-type','callout');
    if (element.classList.contains('to-do-list')) element.setAttribute('data-type','taskList');
    if (element.localName === 'li' && element.closest('.to-do-list')) { element.setAttribute('data-type','taskItem'); element.setAttribute('data-checked', String(!!element.querySelector('.checkbox-on'))); }
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ['srcdoc','srcset','contenteditable'].includes(attribute.name)) element.removeAttribute(attribute.name);
      if (attribute.name === 'style') { const styles = attribute.value.split(';').filter(style => /^\s*(color|background-color|text-align)\s*:\s*[#\w(),.%\s-]+$/i.test(style)); if (styles.length) element.setAttribute('style',styles.join(';')); else element.removeAttribute('style'); }
      if (['href','src'].includes(attribute.name)) { const value = convertLink(attribute.value); if (value) element.setAttribute(attribute.name,value); else element.removeAttribute(attribute.name); }
    }
  }
}

export function readNotionDirectory(root, sourceId) {
  const files = walk(root), pages = files.filter(file => /\.(html|md|csv)$/i.test(file) && pageId(basename(file)));
  if (!pages.length) throw new Error('No Notion pages found. Export HTML or Markdown with subpages enabled.');
  const byPath = new Map(), byId = new Map(), parents = new Map(), byDirectory = new Map();
  const report = { pages: 0, databases: 0, rows: 0, assets: files.filter(f=>/[.](png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|mp3|wav|ogg|pdf)$/i.test(f)).length, mediaLinks: 0, warnings: [], missingLinks: [], sourceId };
  const asset = file => `localflow-asset://${sourceId}/${relative(root,file).split(sep).map(encodeURIComponent).join('/')}`;
  for (const file of pages) {
    const source = pageId(basename(file));
    if (byId.has(source)) { const existing=byId.get(source); byPath.set(resolve(file),existing); if(extname(file)==='.csv')existing.csvFile=file; else existing.importFile=file; continue; }
    const item = { id: localId(source), kind: 'note', label: basename(file,extname(file)).replace(/\s*[a-f0-9]{32}$/i,'').trim() || 'Untitled', sourceUrl: `https://www.notion.so/${source}`, children: [], content: '', importFile: file };
    if(extname(file)==='.csv')item.csvFile=file;
    byPath.set(resolve(file),item); byId.set(source,item);
    byDirectory.set(resolve(dirname(file),basename(file,extname(file)).replace(/\s*[a-f0-9]{32}$/i,'')),item);
  }
  const link = (value, file) => {
    if (!value) return '';
    if (value.startsWith('#')) return value;
    if (/^(https?:|mailto:|tel:)/i.test(value)) { try { const url = new URL(value), id = url.pathname.replace(/-/g,'').match(/([a-f0-9]{32})$/i)?.[1]?.toLowerCase(); return /(^|\.)notion\.(so|com)$/.test(url.hostname) && byId.has(id) ? `localflow-note://${localId(id)}` : value; } catch { return ''; } }
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) return '';
    let target; try { target = resolve(dirname(file),decodeURIComponent(value));if(!existsSync(target))target=resolve(dirname(file),decodeURIComponent(value.split('#')[0].split('?')[0])); } catch { return ''; }
    if (!inside(root,target)) return '';
    if (byPath.has(target)) return `localflow-note://${byPath.get(target).id}`;
    const id=pageId(basename(target)),page=exportedPage(byId,target);if(page)return `localflow-note://${page.id}`;
    if(existsSync(target))return asset(target);
    report.missingLinks.push({page:relative(root,file),target:value});return id?`https://www.notion.so/${id}`:'';
  };
  for (const item of byId.values()) {
    const file = item.importFile;
    if(item.csvFile)item.kind='database';
    if (statSync(file).size > 10_000_000) throw new Error(`Page exceeds 10 MB: ${item.label}`);
    const source = readFileSync(file,'utf8');
    if (extname(file).toLowerCase() === '.md') item.content = source.replace(/(!?\[[^\]]*\]\()([^\n]*?)(\))/g,(_,a,url,b)=>a+(link(url,file) || url)+b);
    else if(extname(file).toLowerCase() === '.html') {
      const { document } = parseHTML(source), body = document.querySelector('.page-body') || document.querySelector('article') || document.body;
      const title = document.querySelector('.page-title'); if (title?.textContent.trim()) item.label = title.textContent.trim().slice(0,300);
      const cover=document.querySelector('.page-cover-image'),icon=document.querySelector('.page-header-icon img');
      item.presentation={wide:Boolean(body.querySelector('.column-list')),cover:link(cover?.getAttribute('src')||'',file),icon:link(icon?.getAttribute('src')||'',file),coverPosition:Math.max(0,Math.min(100,parseFloat(cover?.style.objectPosition?.split(' ').at(-1))||50))};
      if (!icon) item.presentation.iconText = document.querySelector('.page-header-icon')?.textContent.trim().slice(0,32) || '';
      item.rowTitle=title?.textContent || '';
      item.rowProperties=readRowProperties(document,value=>link(value,file));
      cleanHtml(body,value=>link(value,file),report);
      item.html=body.innerHTML; item.content=htmlToMarkdown(body).replace(/\n{3,}/g,'\n\n').trim();
    }
    if(item.kind==='note') report.pages++;
    let parent=dirname(file);
    while (inside(root,parent)) { const ancestor=byDirectory.get(resolve(parent)) || byId.get(pageId(basename(parent))); if(ancestor && ancestor.id!==item.id) { parents.set(item.id,ancestor); break; } parent=dirname(parent); }

  }
  const children=[], groups=new Map();
  for(const item of byId.values()) {
    const parent=parents.get(item.id);
    if(parent)parent.children.push(item);
    else {
      const parts=relative(root,item.importFile).split(sep), group=parts.length>2 && !parts[1].startsWith('Untitled ') ? parts[1] : 'Other exported pages';
      if(!groups.has(group)){const folder={id:`notion-group-${key(sourceId+group)}`,kind:'folder',label:group,children:[]};groups.set(group,folder);children.push(folder);}
      groups.get(group).children.push(item);
    }
  }
  for(const item of byId.values())if(item.csvFile){item.database=databaseFromExport(item,readFileSync(item.csvFile,'utf8'),item.children.filter(c=>c.kind==='note'));report.databases++;report.rows+=item.database.rows.length;}
  for(const item of byId.values()) {
    delete item.importFile;delete item.csvFile;delete item.rowProperties;delete item.rowTitle;
    if(item.database)for(const property of item.database.properties)if(property.type==='relation'){
      const targets=new Set(item.database.rows.flatMap(row=>row.values[property.id] || []).map(id=>parents.get(id)?.id).filter(Boolean));
      if(targets.size===1)property.target=[...targets][0];
    }
  }
  return { sourceId, items:[{ id:`notion-import-${sourceId}`,kind:'folder',label:'Notion import',children }], report };
}

export async function prepareNotionImport(zipPath, notesRoot, { python, storageRoot=notesRoot } = {}) {
  if (extname(zipPath).toLowerCase() !== '.zip') throw new Error('Choose a Notion export ZIP.');
  const hash=createHash('sha256'); for await(const chunk of createReadStream(zipPath)) hash.update(chunk);
  const sourceId=hash.digest('hex').slice(0,32), directory=resolve(storageRoot,'imports',sourceId), complete=join(directory,'.extracted');
  mkdirSync(directory,{recursive:true});
  if(!existsSync(complete)) {
    if(!python)throw new Error('The bundled Python runtime is required for ZIP import.');
    await promisify(execFile)(python.command,[...(python.args || []),fileURLToPath(new URL('./extract.py',import.meta.url)),zipPath,directory],{windowsHide:true,maxBuffer:1_000_000});
    writeFileSync(complete,'ok');
  }
  const locationsFile=join(notesRoot,'imports','locations.json');mkdirSync(dirname(locationsFile),{recursive:true});
  const locations=existsSync(locationsFile)?JSON.parse(readFileSync(locationsFile,'utf8')):{};
  writeFileSync(locationsFile,JSON.stringify({...locations,[sourceId]:directory}));
  const bundle=readNotionDirectory(directory,sourceId);
  writeFileSync(join(directory,'migration-report.json'),JSON.stringify({...bundle.report,archive:zipPath},null,2));
  return bundle;
}
