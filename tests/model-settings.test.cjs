const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'localflow-model-ui-')));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'settings-ui-preload.cjs'), backgroundThrottling: false } });
  const run = script => window.webContents.executeJavaScript(script);
  const until = async (script) => { for (let attempt = 0; attempt < 100; attempt++) { if (await run(script)) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error(`Timeout: ${script}`); };
  try {
    await window.loadFile(path.resolve('dist/index.html'));
    await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Settings')");
    await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Settings').click()");
    await until("document.querySelector('[aria-label=\"Cleanup model\"]')?.options.length === 3");
    const choose = (label, value) => run(`{ const el=document.querySelector('[aria-label="${label}"]'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); }`);
    await choose('Cleanup model', 'gpt-live-1-codex');
    await until("document.querySelector('[aria-label=\"Cleanup model\"]').value==='gpt-live-1-codex' && !document.querySelector('[aria-label=\"Cleanup model\"]').disabled");
    await until("document.querySelector('[aria-label=\"Live1 voice\"]').options.length===9");
    assert.equal(await run("[...document.querySelector('[aria-label=\"Live1 voice\"]').options].some(o=>o.value==='shimmer')"), false);
    await choose('Live1 voice', 'maple');
    await until("document.querySelector('[aria-label=\"Live1 voice\"]').value==='maple' && !document.querySelector('[aria-label=\"Live1 voice\"]').disabled");
    await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Niwa Agent').click()");
    await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Settings').click()");
    await until("document.querySelector('[aria-label=\"Live1 voice\"]')?.value==='maple' && document.querySelector('[aria-label=\"Cleanup model\"]')?.value==='gpt-live-1-codex'");
    console.log('MODEL_SETTINGS_UI_OK: model selection, nine supported voices, saved choices restored');
    window.destroy(); app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
