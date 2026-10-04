const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=file=>{const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024),fd=fs.openSync(file,'r');try{let bytes;while((bytes=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,bytes));return hash.digest('hex');}finally{fs.closeSync(fd);}};
function inventory(directory,relative='') {
  return fs.readdirSync(path.join(directory,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
    if(['__pycache__','.cache','.links'].includes(entry.name)||entry.name.endsWith('.pyc'))return [];
    const name=path.join(relative,entry.name),file=path.join(directory,name);
    if(entry.isSymbolicLink())throw Error('Runtime components cannot contain links: '+file);
    return entry.isDirectory()?inventory(directory,name):[{path:name.replaceAll('\\','/'),sha256:digest(file),bytes:fs.statSync(file).size}];
  });
}
function link(source,target) {
  fs.mkdirSync(path.dirname(target),{recursive:true});
  try{fs.linkSync(source,target);}catch(error){if(!['EXDEV','EPERM','ENOTSUP'].includes(error.code))throw error;fs.copyFileSync(source,target);}
}
function component(root,output,from,to=from) {
  const source=path.join(root,from),files=inventory(source);
  const hash=crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const pool=path.join(root,'release','.components',hash);
  if(!fs.existsSync(pool)) {
    const staging=pool+'.stage-'+process.pid;fs.mkdirSync(staging,{recursive:true});
    for(const file of files){const destination=path.join(staging,file.path);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(source,file.path),destination);}
    fs.renameSync(staging,pool);
  }
  for(const file of files)link(path.join(pool,file.path),path.join(output,to,file.path));
  console.log('SHARED_WINDOWS_COMPONENT',to,hash.slice(0,12),files.reduce((sum,file)=>sum+file.bytes,0));
  return {path:to,sha256:hash,files};
}
module.exports={component,link};
