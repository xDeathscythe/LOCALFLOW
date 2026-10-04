const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {component,link}=require('./release-components.cjs');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
execFileSync(process.execPath,[path.join(root,'scripts/stage-dependency-notices.cjs')],{stdio:'inherit',windowsHide:true});
const output=path.join(root,'release',`LocalFlow-${version}-Windows-x64`);
if(fs.existsSync(output))throw Error('Use a fresh release directory; never overwrite an open application.');
fs.mkdirSync(output,{recursive:true});
function copy(from,to=from){
  const source=path.join(root,from);if(!fs.existsSync(source))throw Error('Missing Windows payload: '+from);
  fs.cpSync(source,path.join(output,to),{recursive:true,filter:file=>!['__pycache__','.cache'].includes(path.basename(file))&&!file.endsWith('.pyc')});
  console.log('WINDOWS_PAYLOAD',to);
}
copy('src-tauri/target/release/localflow-desktop.exe','LocalFlow.exe');
for(const directory of ['desktop','host','backend','tts','licenses'])copy(directory);
for(const file of fs.readdirSync(path.join(root,'assets')).filter(file=>fs.statSync(path.join(root,'assets',file)).isFile()))copy('assets/'+file);
copy('assets/tts/README.md');
copy('runtime/print-math','assets/print-math');
copy('runtime/dependency-notices','licenses/dependencies');
for(const file of ['LICENSE','README.md','THIRD_PARTY_NOTICES.md','start-localflow-desktop.ps1','scripts/install-tts.ps1','scripts/prepare-tts-models.py','scripts/update-localflow.ps1'])copy(file);
copy('docs');
const components=[];
for(const directory of ['node','python','python-packages','cuda','prerequisites'])components.push(component(root,output,'runtime/'+directory));
const browserSpecs=require('../node_modules/playwright-core/browsers.json').browsers;
for(const name of ['chromium-headless-shell','ffmpeg','winldd']){
  const spec=browserSpecs.find(browser=>browser.name===name);if(!spec)throw Error('Missing Playwright component: '+name);
  const directory=`${name.replaceAll('-','_')}-${spec.revision}`;
  components.push(component(root,output,'runtime/browsers/'+directory));
}
fs.cpSync(path.join(root,'runtime/native-host/node_modules'),path.join(output,'node_modules'),{recursive:true,filter:file=>path.basename(file)!=='codex-win32-x64'});
components.push(component(root,output,'runtime/native-host/node_modules/@openai/codex-win32-x64','node_modules/@openai/codex-win32-x64'));
copy('runtime/native-host/manifest.json','host-manifest.json');
components.push(component(root,output,'runtime/distribution/windows-mcp','runtime/windows-mcp'));
components.push(component(root,output,'models/whisper/large-v3'));
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify({name:'localflow',version,type:'module',license:'MIT'}));
const app=path.join(output,'LocalFlow.exe');
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({version,platform:'Windows x64',shell:'Tauri 2 / system WebView2',node:process.version,executableSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(app)).digest('hex')},null,2));
fs.writeFileSync(path.join(output,'runtime-components.json'),JSON.stringify({version,components},null,2));
// A core update carries code/dependencies. The updater verifies and reuses installed runtimes/models.
const update=output+'-update';if(fs.existsSync(update))throw Error('Core update directory already exists.');fs.mkdirSync(update);
const shared=new Set(components.map(value=>path.normalize(value.path)));
function core(directory,relative=''){for(const entry of fs.readdirSync(path.join(directory,relative),{withFileTypes:true})){
  if(!relative&&['runtime','models'].includes(entry.name))continue;
  const name=path.join(relative,entry.name);if(shared.has(name))continue;
  if(entry.isDirectory())core(directory,name);else link(path.join(directory,name),path.join(update,name));
}}core(output);
if(process.argv.includes('--zip')){
  execFileSync(path.join(root,'runtime/python/python.exe'),[path.join(root,'scripts/zip-release.py'),output],{stdio:'inherit',windowsHide:true});
}
console.log('NATIVE_WINDOWS_RELEASE',output);
