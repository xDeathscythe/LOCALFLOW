const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),destination=path.join(root,'runtime/native-host'),target=path.join(root,'runtime',`native-host-stage-${process.pid}`);
fs.mkdirSync(target);
fs.mkdirSync(path.join(root,'runtime/node'),{recursive:true});
fs.copyFileSync(process.execPath,path.join(root,'runtime/node/node.exe'));
const print=path.join(root,'runtime/print-math');fs.mkdirSync(path.join(print,'fonts'),{recursive:true});
fs.copyFileSync(path.join(root,'node_modules/katex/dist/katex.min.css'),path.join(print,'katex.min.css'));
for(const file of fs.readdirSync(path.join(root,'node_modules/katex/dist/fonts')).filter(file=>file.endsWith('.woff2')))fs.copyFileSync(path.join(root,'node_modules/katex/dist/fonts',file),path.join(print,'fonts',file));
const visited=new Set();
function stage(name,from) {
  const require=createRequire(path.join(from,'package.json'));
  const directory=require.resolve.paths(name).map(base=>path.join(base,name)).find(base=>fs.existsSync(path.join(base,'package.json')));
  if(!directory)throw Error('Missing host dependency: '+name);
  if(visited.has(directory))return;
  const relative=path.relative(path.join(root,'node_modules'),directory);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Host dependency must come from the project lockfile.');
  visited.add(directory);
  fs.cpSync(directory,path.join(target,'node_modules',relative),{recursive:true,filter:file=>!['test','tests','.github','examples'].includes(path.basename(file))});
  const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
  for(const dependency of Object.keys(pkg.dependencies||{}))stage(dependency,directory);
  for(const dependency of Object.keys(pkg.optionalDependencies||{})) {
    const candidates=createRequire(path.join(directory,'package.json')).resolve.paths(dependency);
    if(candidates.some(base=>fs.existsSync(path.join(base,dependency,'package.json'))))stage(dependency,directory);
  }
}
for(const dependency of ['@modelcontextprotocol/client','@mozilla/readability','linkedom','jsep','jose','playwright','typebox','@openai/codex-win32-x64','@tiptap/markdown','@tiptap/starter-kit','@tiptap/extension-task-list','@tiptap/extension-task-item'])stage(dependency,root);
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({version:require('../package.json').version,node:process.version,packages:[...visited].map(directory=>({path:path.relative(root,directory),...JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'))})).map(({path,name,version,license})=>({path,name,version,license}))},null,2));
const previous=path.join(root,'runtime',`native-host-previous-${process.pid}`);
if(fs.existsSync(destination))fs.renameSync(destination,previous);
fs.renameSync(target,destination);
// This exact generated path contains only the replaced host dependency staging tree.
if(path.dirname(previous)!==path.join(root,'runtime'))throw Error('Invalid staging cleanup path.');
if(fs.existsSync(previous))fs.rmSync(previous,{recursive:true});
console.log('NATIVE_HOST_RUNTIME_STAGED',visited.size,'packages; no Electron payload.');
