const { spawn } = require('node:child_process');
const path = require('node:path');
const { resolvePython, resourcesRoot } = require('./runtime-config.cjs');
const pending = new WeakMap();

function applyWindowGlass(window, enabled) {
  if (process.platform !== 'win32') return;
  pending.get(window)?.kill();
  const python = resolvePython();
  const handle = window.getNativeWindowHandle();
  const hwnd = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
  const child = spawn(python.command, [...python.args, path.join(resourcesRoot(), 'backend', 'window_glass.py'), hwnd, String(process.pid), enabled ? '1' : '0'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  pending.set(window, child);
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  child.on('error', error => console.error('Window glass:', error.message));
  child.on('exit', code => {
    if (pending.get(window) !== child) return;
    pending.delete(window);
    if (code) console.error('Window glass:', error);
  });
  return child;
}
module.exports = { applyWindowGlass };
