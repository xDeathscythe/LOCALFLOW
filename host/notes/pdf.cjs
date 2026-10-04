const {readFile}=require('node:fs/promises');
const {extname}=require('node:path');
const {parseHTML}=require('linkedom');
const {resolveAsset}=require('./asset-path.cjs');

async function printableHtml(root,{title,html}) {
  if(typeof title!=='string'||title.length>300||typeof html!=='string'||html.length>5_000_000)throw new Error('Invalid page export.');
  const {document}=parseHTML('<html><head></head><body></body></html>');document.body.innerHTML=html;
  for(const control of document.body.querySelectorAll('input,textarea,select')){const span=document.createElement('span');span.textContent=control.localName==='select'?(control.querySelector('option[selected]')||control.querySelector('option'))?.textContent||'':control.getAttribute('type')==='checkbox'?(control.hasAttribute('checked')?'☑':'☐'):control.getAttribute('value')||control.textContent||'';control.replaceWith(span);}
  const tags=new Set('p div span section article header footer h1 h2 h3 h4 h5 h6 strong b em i u s del mark blockquote pre code br hr ul ol li table thead tbody tfoot tr th td img a details summary aside figure figcaption button small label input'.split(' '));
  for(const element of [...document.body.querySelectorAll('*')]) {
    if(!tags.has(element.localName)){element.remove();continue;}
    const assetSrc=element.getAttribute('data-asset-src');if(assetSrc)element.setAttribute('src',assetSrc);
    for(const attr of [...element.attributes])if(!['class','style','href','src','alt','colspan','rowspan','data-type','data-checked','checked','type'].includes(attr.name))element.removeAttribute(attr.name);
    const style=element.getAttribute('style')||'';element.removeAttribute('style');
    const safeStyle=style.split(';').filter(rule=>/^\s*(text-align|color|background-color|font-weight|font-style|text-decoration|width|height)\s*:\s*[#\w\s%.,()-]+$/i.test(rule)&&!/url|expression/i.test(rule)).join(';');if(safeStyle)element.setAttribute('style',safeStyle);
    if(element.localName==='details')element.setAttribute('open','');
    if(element.localName==='a'&&!/^(https?:|mailto:|localflow-note:)/i.test(element.getAttribute('href')||''))element.removeAttribute('href');
    if(element.localName==='img') {
      const src=element.getAttribute('src')||'';element.removeAttribute('src');
      if(src.startsWith('localflow-asset:'))try{const file=resolveAsset(root,src),data=await readFile(file),type={'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.gif':'gif','.webp':'webp','.avif':'avif'}[extname(file).toLowerCase()];if(type&&data.length<20_000_000)element.setAttribute('src',`data:image/${type};base64,${data.toString('base64')}`);}catch{}
      else if(/^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(src))element.setAttribute('src',src);
    } else element.removeAttribute('src');
  }
  const heading=document.createElement('h1');heading.textContent=title;document.body.prepend(heading);
  document.head.innerHTML=`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{margin:16mm}body{font:11pt/1.55 'Segoe UI',sans-serif;color:#181818;overflow-wrap:anywhere}h1,h2,h3{break-after:avoid}h1{font-size:24pt}img{max-width:100%;height:auto}img[data-type=page-icon]{width:18px;height:18px}table{border-collapse:collapse;width:100%;font-size:9pt}td,th{border:1px solid #ccc;padding:6px;vertical-align:top}tr,img{break-inside:avoid}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px}blockquote,aside{border-left:3px solid #bbb;padding:10px 16px;background:#f7f7f7}a{color:inherit}button{border:0;background:none;color:inherit;font:inherit;text-align:left;display:block}input{appearance:none}input:checked:after{content:'✓'}[data-type=columns],.noteColumns{display:flex;gap:20px}[data-type=column],.noteColumn{flex:1;min-width:0}.noteDatabaseEmbed{border:1px solid #ddd;padding:12px}summary{font-weight:600}</style>`;
  return '<!doctype html>'+document.documentElement.outerHTML;
}
module.exports={printableHtml};
