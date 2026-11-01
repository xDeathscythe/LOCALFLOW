const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const destination=path.join(root,'runtime/dependency-notices'),output=path.join(root,'runtime',`dependency-notices-stage-${process.pid}`);
fs.mkdirSync(output);
const entries = [];
function collect(kind, name, version, license, directory) {
  const target = path.join(output, kind, `${name.replaceAll('/', '_')}-${version}`);
  const files = fs.readdirSync(directory).filter(file => /^(license|licence|copying|notice)([._-]|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile());
  fs.mkdirSync(target, {recursive:true});
  for (const file of files) fs.copyFileSync(path.join(directory, file), path.join(target, file));
  entries.push({kind, name, version, license, files, source:kind === 'rust' ? `https://crates.io/crates/${name}/${version}` : `https://www.npmjs.com/package/${name}/v/${version}`});
}
const lock = require('../package-lock.json');
for (const location of Object.keys(lock.packages).filter(location => location.startsWith('node_modules/'))) {
  const directory = path.join(root, location), manifest = path.join(directory, 'package.json');
  if (!fs.existsSync(manifest)) continue;
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  collect('javascript', pkg.name, pkg.version, pkg.license, directory);
}
const cargo = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml')], {maxBuffer:20*1024*1024, windowsHide:true}));
for (const pkg of cargo.packages.filter(pkg => pkg.source)) collect('rust', pkg.name, pkg.version, pkg.license, path.dirname(pkg.manifest_path));
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(entries, null, 2));
const previous=path.join(root,'runtime',`dependency-notices-previous-${process.pid}`);
if(fs.existsSync(destination))fs.renameSync(destination,previous);
fs.renameSync(output,destination);
if(path.dirname(previous)!==path.join(root,'runtime'))throw Error('Invalid notice staging cleanup path.');
if(fs.existsSync(previous))fs.rmSync(previous,{recursive:true});
console.log('DEPENDENCY_NOTICES_STAGED', entries.length);
