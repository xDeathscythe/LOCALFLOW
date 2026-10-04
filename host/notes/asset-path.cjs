const { existsSync, readFileSync, statSync } = require('node:fs');
const { isAbsolute, join, relative, resolve, sep } = require('node:path');

function resolveAsset(root, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'localflow-asset:' || !/^[a-f0-9]{32}$/.test(parsed.hostname)) throw new Error('Invalid asset URL.');
  const locationsFile = join(root, 'imports', 'locations.json');
  const locations = existsSync(locationsFile) ? JSON.parse(readFileSync(locationsFile, 'utf8')) : {};
  const base = resolve(locations[parsed.hostname] || join(root, 'imports', parsed.hostname));
  const file = resolve(base, decodeURIComponent(parsed.pathname).replace(/^[/\\]+/, ''));
  const rel = relative(base, file);
  if (!rel || isAbsolute(rel) || rel.split(sep).includes('..') || !existsSync(file) || !statSync(file).isFile()) throw new Error('Asset not found.');
  return file;
}

module.exports = { resolveAsset };
