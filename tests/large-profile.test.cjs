const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const executable = path.resolve(process.argv[2]);
const profile = path.resolve(process.argv[3]);
assert(profile.includes(`${path.sep}runtime${path.sep}large-install-`), 'Use only an isolated test profile');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(LOCALFLOW_|PYTHON|HF_|HUGGINGFACE_|TRANSFORMERS_|CODEX_|VITE_|ELECTRON_)/i.test(key)));
Object.assign(env, { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, HF_HUB_OFFLINE: '1', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' });
(async () => {
  for (const [saved, expected] of [['base', 'base'], ['auto', 'large-v3']]) {
    fs.writeFileSync(path.join(profile, '.env'), `LOCALFLOW_WHISPER_MODEL=${saved}\n`);
    const application = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], cwd: profile, env, timeout: 60000 });
    try {
      await application.firstWindow();
      let page;
      for (let i = 0; i < 100 && !page; i++) {
        page = application.windows().find(window => window.url().endsWith('/dist/index.html'));
        if (!page) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(page);
      await page.waitForSelector('.navList', { timeout: 60000 });
      assert.equal(await application.evaluate(() => process.env.LOCALFLOW_WHISPER_MODEL), expected);
      const result = await page.evaluate(wav => window.localflow.transcribeFile({ path: wav, options: { cleanup: false, cleanupLevel: 'none' } }), path.resolve('tests/fixtures/dictation.wav'));
      assert.match(result.rawText.toLowerCase(), /orange bicycle/);
      assert.match(fs.readFileSync(path.join(profile, '.env'), 'utf8'), new RegExp(`LOCALFLOW_WHISPER_MODEL=${expected}`));
      console.log('OFFLINE_RESTART_MODEL_OK', { saved, expected });
    } finally { await application.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
