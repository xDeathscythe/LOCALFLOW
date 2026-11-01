import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function freePort() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
export async function startTunnel({ token, localPort, command, publishEndpoint = async () => {}, changed = () => {} }) {
  const installed = process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe');
  const executable = command || process.env.LOCALFLOW_CLOUDFLARED_EXE || (installed && existsSync(installed) ? installed : 'cloudflared');
  const port = await freePort();
  let child, closed = false, timer, attempt = 0, online = false, endpoint = '', pending;
  const launch = () => {
    if (closed) return;
    const env = { ...process.env }; delete env.TUNNEL_TOKEN;
    if (token) env.TUNNEL_TOKEN = token;
    child = spawn(executable, ['tunnel', '--no-autoupdate', '--metrics', `127.0.0.1:${port}`, ...(token ? ['run'] : ['--url', `http://127.0.0.1:${localPort}`])], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], env });
    let stopped = false;
    const restart = error => {
      if (stopped || closed) return; stopped = true; online = false; endpoint = ''; changed({ status: 'reconnecting', error: error ? 'Install cloudflared or configure its executable in Account settings.' : 'Reconnecting to the secure tunnel.' });
      timer = setTimeout(launch, Math.min(60_000, 2000 * 2 ** Math.min(attempt++, 5))); timer.unref?.();
    };
    child.once('error', restart); child.once('exit', () => restart());
  };
  launch();
  const check = async () => {
    const active = child;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(2000) });
      if (closed || active !== child) return;
      const next = response.ok;
      if (next && !token) {
        // cloudflared exposes the endpoint as JSON; no language-dependent log matching.
        const status = await fetch(`http://127.0.0.1:${port}/quicktunnel`, { signal: AbortSignal.timeout(2000) }).then(result => result.json());
        if (closed || active !== child) return;
        if (!/^[a-z0-9-]+\.trycloudflare\.com$/.test(status.hostname || '')) throw new Error('The tunnel did not return a valid address.');
        const address = `https://${status.hostname}`;
        if (address !== endpoint) { await publishEndpoint(address); if (closed || active !== child) return; endpoint = address; }
      }
      if (next !== online) { online = next; if (next) attempt = 0; changed({ status: next ? 'online' : 'reconnecting', error: '' }); }
    } catch { if (!closed && online) { online = false; changed({ status: 'reconnecting', error: '' }); } }
  };
  const poll = setInterval(() => { if (!closed && !pending) pending = check().finally(() => { pending = null; }); }, 2000); poll.unref?.();
  return { online: () => online, async close() { closed = true; clearTimeout(timer); clearInterval(poll); child?.kill(); await pending; } };
}
