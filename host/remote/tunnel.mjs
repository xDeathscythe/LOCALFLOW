import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function freePort() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
export async function startManagedTunnel({ token, command, changed = () => {} }) {
  const installed = process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe');
  const executable = command || process.env.LOCALFLOW_CLOUDFLARED_EXE || (installed && existsSync(installed) ? installed : 'cloudflared');
  const port = await freePort();
  let child, closed = false, timer, attempt = 0, online = false;
  const launch = () => {
    if (closed) return;
    child = spawn(executable, ['tunnel', '--no-autoupdate', '--metrics', `127.0.0.1:${port}`, 'run'], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, TUNNEL_TOKEN: token } });
    let stopped = false;
    const restart = error => {
      if (stopped || closed) return; stopped = true; online = false; changed({ status: 'reconnecting', error: error ? 'Install cloudflared or configure its executable in Account settings.' : 'Reconnecting to the secure tunnel.' });
      timer = setTimeout(launch, Math.min(60_000, 2000 * 2 ** Math.min(attempt++, 5))); timer.unref?.();
    };
    child.once('error', restart); child.once('exit', () => restart());
  };
  launch();
  const poll = setInterval(async () => {
    if (closed) return;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(2000) });
      if (closed) return;
      const next = response.ok;
      if (next !== online) { online = next; if (next) attempt = 0; changed({ status: next ? 'online' : 'reconnecting', error: '' }); }
    } catch { if (!closed && online) { online = false; changed({ status: 'reconnecting', error: '' }); } }
  }, 5000); poll.unref?.();
  return { online: () => online, close() { closed = true; clearTimeout(timer); clearInterval(poll); child?.kill(); } };
}
