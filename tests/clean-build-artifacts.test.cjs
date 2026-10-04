const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localflow-clean-builds-'));
const script = path.join(root, 'scripts', 'clean-build-artifacts.ps1');
fs.mkdirSync(path.dirname(script), { recursive: true });
fs.copyFileSync(path.resolve('scripts/clean-build-artifacts.ps1'), script);
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.115' }));
function release(profile, version, valid = true) {
  const directory = path.join(root, 'release', `${profile}-${version}`, 'nsis-web');
  fs.mkdirSync(directory, { recursive: true });
  const names = [`LocalFlow Offline Setup ${version}.exe`, `localflow-${version}-x64.nsis.7z`];
  const hashes = names.map(name => {
    const data = Buffer.from(name); fs.writeFileSync(path.join(directory, name), data);
    return `${crypto.createHash('sha256').update(data).digest('hex')}  ${name}`;
  });
  fs.writeFileSync(path.join(directory, `SHA256SUMS-${version}.txt`), hashes.join('\n'));
  if (!valid) fs.appendFileSync(path.join(directory, names[1]), 'corrupt');
  return path.dirname(directory);
}
// Let Windows PowerShell select its own modules when this test is launched from pwsh.
const env = { ...process.env }; delete env.PSModulePath;
const run = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', windowsHide: true, env });
let active;
(async () => {
  try {
    const activePath = release('windows-large', '0.1.111');
    const old = release('windows-large', '0.1.112');
    const rollback = release('windows-large', '0.1.114');
    const current = release('windows-large', '0.1.115');
    const incomplete = release('windows-large', '0.1.116', false);
    const otherProfile = release('windows-gpu', '0.1.112');
    release('windows-gpu', '0.1.113');
    active = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', activePath], { windowsHide: true, stdio: 'ignore' });
    await new Promise(resolve => active.once('spawn', resolve));
    const result = run(); assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.Applied, false); assert.equal(plan.CurrentReleaseVerified, true);
    assert.deepEqual(plan.Artifacts.map(item => item.Path), [old]);
    for (const kept of [rollback, current, incomplete, otherProfile]) assert(plan.Retained.includes(kept));
    assert(plan.Skipped.some(item => item.Path === activePath));
    assert(fs.existsSync(old), 'dry run must leave deletion candidate intact');
    const payload = path.join(current, 'nsis-web', 'localflow-0.1.115-x64.nsis.7z');
    fs.renameSync(payload, payload + '.missing');
    const blocked = run('-Apply'); assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /complete current installer and payload/);
    assert(fs.existsSync(old), 'incomplete current release must prevent every deletion');
    // A junction in a target or its ancestors must fail closed, including dry runs.
    const outside = path.join(root, 'preserve-models'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, 'release', 'win-unpacked'), 'junction');
    const linked = run(); assert.notEqual(linked.status, 0); assert.match(linked.stderr, /Refusing linked artifact/);
    console.log('BUILD_RETENTION_OK: per-profile verified rollback, corrupt new build, active process, missing payload, junction and dry-run safety');
  } finally {
    if (active && active.exitCode === null) { active.kill(); await new Promise(resolve => active.once('exit', resolve)); }
    const resolved = path.resolve(root);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('localflow-clean-builds-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
