const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
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
copy('runtime/dependency-notices','licenses/dependencies');
for(const file of ['LICENSE','README.md','THIRD_PARTY_NOTICES.md','start-localflow-desktop.ps1','scripts/install-tts.ps1','scripts/prepare-tts-models.py'])copy(file);
copy('docs/windows-rework-0.2.0.md');
for(const directory of ['node','python','python-packages','cuda','browsers','prerequisites'])copy('runtime/'+directory);
copy('runtime/native-host/node_modules','node_modules');
copy('runtime/native-host/manifest.json','host-manifest.json');
copy('runtime/distribution/windows-mcp','runtime/windows-mcp');
copy('models/whisper/large-v3');
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify({name:'localflow',version,type:'module',license:'MIT'}));
const app=path.join(output,'LocalFlow.exe');
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({version,platform:'Windows x64',shell:'Tauri 2 / system WebView2',node:process.version,executableSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(app)).digest('hex')},null,2));
if(process.argv.includes('--zip')){
  execFileSync(path.join(root,'runtime/python/python.exe'),['-m','zipfile','-c',output+'.zip',output],{stdio:'inherit',windowsHide:true});
}
console.log('NATIVE_WINDOWS_RELEASE',output);
