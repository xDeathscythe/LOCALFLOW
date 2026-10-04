const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveAsset } = require('../electron/notes/asset-path.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localflow-assets-'));
try {
  const id = 'a'.repeat(32), assets = path.join(root, 'imports', id);
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, '日本語.png'), 'image');
  assert.equal(resolveAsset(root, `localflow-asset://${id}/${encodeURIComponent('日本語.png')}`), path.join(assets, '日本語.png'));
  for (const url of [`https://${id}/photo.png`, `localflow-asset://${id}/..%2F..%2Foutside.txt`, `localflow-asset://${id}/missing.png`, `localflow-asset://${id}/`]) assert.throws(() => resolveAsset(root, url));
  const external = path.join(root, 'source');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'image.png'), 'external image');
  fs.writeFileSync(path.join(root, 'imports', 'locations.json'), JSON.stringify({ [id]: external }));
  assert.equal(resolveAsset(root, `localflow-asset://${id}/image.png`), path.join(external, 'image.png'));
  const sample = module => Array.from({ length: 5 }, () => Number(execFileSync(process.execPath, ['--input-type=module', '-e', `const start=performance.now();await import(${JSON.stringify(module)});console.log(performance.now()-start)`], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).trim())).sort((a,b) => a-b);
  const before = sample('./electron/notes/notion-import.mjs'), after = sample('./electron/notes/asset-path.cjs');
  console.log(JSON.stringify({ assetResolverStartupImportMs: { beforeMedian: before[2], afterMedian: after[2], beforeSamples: before, afterSamples: after }, checks: 'local paths, external imports, Unicode, traversal, missing assets' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
