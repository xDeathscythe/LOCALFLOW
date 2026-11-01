import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from '../niwa/host/niwa-store.mjs';

// DPAPI binds credentials to this Windows user. Plaintext never enters argv or logs.
function dpapi(value, decrypt) {
  if (process.platform !== 'win32') return Promise.reject(new Error('An OS credential store is required on this platform.'));
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=${decrypt ? '[Convert]::FromBase64String($v)' : '[Text.Encoding]::UTF8.GetBytes($v)'}; $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${decrypt ? '[Text.Encoding]::UTF8.GetString($r)' : '[Convert]::ToBase64String($r)'});`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows credential protection timed out.')); }, 15_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Windows credential protection is unavailable.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('Windows credential protection failed.')); });
    child.stdin.end(value);
  });
}

export function createAccountVault(directory, codec = { encode: value => dpapi(value, false), decode: value => dpapi(value, true) }) {
  const file = join(directory, 'account', 'credentials.json');
  let writing = Promise.resolve();
  return {
    async read() { const saved = readJsonFile(file, null); return saved ? JSON.parse(await codec.decode(saved.protected)) : null; },
    write(value) { const result = writing.then(async () => writeJsonFile(file, value ? { protected: await codec.encode(JSON.stringify(value)) } : null)); writing = result.catch(() => {}); return result; },
  };
}
