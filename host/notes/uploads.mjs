import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';

const mimeTypes = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml','.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.txt':'text/plain','.csv':'text/csv'};
export async function storeUploads(root, files) {
  if (!Array.isArray(files) || !files.length || files.length > 30) throw new Error('Choose 1–30 files.');
  let total=0;
  const checked=files.map(file=>{
    if(typeof file?.name!=='string'||!file.name.trim()||!(file.data instanceof Uint8Array))throw new Error('Invalid file.');
    if(!file.data.length||file.data.length>50_000_000||(total+=file.data.length)>150_000_000)throw new Error('Files must be at most 50 MB each and 150 MB together.');
    const name=basename(file.name.replace(/\\/g,'/')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(-180);
    if(!name||name==='.'||name==='..')throw new Error('Invalid filename.');
    return {name,data:file.data};
  });
  return Promise.all(checked.map(async({name,data})=>{
    const id=createHash('sha256').update(data).digest('hex').slice(0,32), directory=join(root,'imports',id);
    await mkdir(directory,{recursive:true});await writeFile(join(directory,name),data,{flag:'w'});
    return {name,url:`localflow-asset://${id}/${encodeURIComponent(name)}`,mime:mimeTypes[extname(name).toLowerCase()]||'application/octet-stream',size:data.length};
  }));
}
export async function importUploadPaths(root, paths) {
  if(paths.length>30)throw new Error('Choose at most 30 files.');
  let total=0;
  for(const file of paths){const info=await stat(file);if(!info.isFile()||info.size>50_000_000||(total+=info.size)>150_000_000)throw new Error('Files must be at most 50 MB each and 150 MB together.');}
  return storeUploads(root,await Promise.all(paths.map(async file=>({name:basename(file),data:await readFile(file)}))));
}
