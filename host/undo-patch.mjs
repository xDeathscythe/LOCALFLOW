import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

function apply(cwd, diff, check) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['apply', '--reverse', '--whitespace=nowarn', ...(check ? ['--check'] : []), '-'], { cwd, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Undo timed out.')); }, 15000);
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); });
    child.on('error', failure => { clearTimeout(timeout); reject(failure); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Cannot undo this patch without affecting newer changes. ${error.trim()}`)); });
    child.stdin.on('error', () => {});
    child.stdin.end(diff);
  });
}
export async function undoPatch(cwd, diff) {
  if (typeof diff !== 'string' || !diff.trim()) throw new Error('There are no changes to undo.');
  // Git silently skips some paths from subdirectories; require the repository root for Undo.
  const { stdout: prefix } = await promisify(execFile)('git', ['rev-parse', '--show-prefix'], { cwd, windowsHide: true, timeout: 15000 }).catch(() => ({ stdout: '' }));
  if (prefix.trim()) throw new Error('Open the repository root as the workspace to undo this patch.');
  await apply(cwd, diff, true);
  await apply(cwd, diff, false);
}
