const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function checkEdge(page, browser, pid) {
  const call = (method, value) => page.evaluate(({ method, value }) =>
    window.__TAURI__.core.invoke('native_call', { method, args: [value] }), { method, value });
  const check = (surface, hidden = false) => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-File', path.resolve('tests/native-overlay-order.ps1'),
      '-NativeProcessId', String(pid), '-Surface', surface, ...(hidden ? ['-Hidden'] : [])], { windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  const surface = async name => {
    for (let i = 0; i < 100; i++) {
      const view = browser.contexts().flatMap(context => context.pages()).find(view => view.url().endsWith(`/${name}.html`));
      if (view) return view;
      await page.waitForTimeout(50);
    }
    assert.fail(`Missing ${name} surface`);
  };
  const edge = await surface('edge');
  await edge.waitForSelector('body.collapsed');
  check('edge');
  for (const enabled of [false, true]) {
    await call('set-edge-settings', { enabled, autoHide: true });
    check('edge', !enabled);
  }
  for (const expanded of [true, false, true]) {
    await call('edge-hover', expanded ? 1 : null);
    await edge.waitForFunction(expanded => document.body.classList.contains('collapsed') !== expanded, expanded);
    check('edge');
  }
  await call('window-minimize');
  check('edge');
  await call('edge-action', 'transcribe');
  await page.waitForSelector('.meetingsPage');
  check('edge');
  await call('set-edge-settings', { enabled: false, autoHide: true });
  await call('window-hide');
  await call('overlay-state', { recording: true, starting: false, elapsedSeconds: 65 });
  const recording = await surface('recording');
  await recording.waitForFunction(() => document.querySelector('output').textContent === '1:05');
  check('recording');
  assert(await recording.evaluate(()=>{const rect=document.querySelector('button').getBoundingClientRect();return rect.right<=innerWidth && rect.bottom<=innerHeight;}),'The recording control must fit inside its native client area.');
  await page.evaluate(()=>window.__TAURI__.event.listen('recording-overlay-stop',()=>window.overlayStopReceived=true));
  await recording.getByRole('button',{name:'Stop dictation'}).click({timeout:5000});
  await page.waitForFunction(()=>window.overlayStopReceived===true);
  await call('overlay-state', { recording: false, starting: false });
  await call('set-edge-settings', { enabled: true, autoHide: true });
  check('edge');
  console.log('NATIVE_EDGE_TOPMOST_OK startup, hide/show, hover, minimize, navigation, recording; no focus theft');
};
