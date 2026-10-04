const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const executable = path.resolve(process.argv[2]);
const directory = fs.mkdtempSync(path.resolve('runtime/large-install-'));
const profile = path.join(directory, 'profile');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(LOCALFLOW_|PYTHON|HF_|HUGGINGFACE_|TRANSFORMERS_|CODEX_|VITE_|ELECTRON_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key)));
Object.assign(env, { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, PYTHONNOUSERSITE: '1', TEMP: directory, TMP: directory });
const wav = path.resolve('tests/fixtures/dictation.wav');

async function run() {
  const application = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], cwd: directory, env, timeout: 60000 });
  try {
    assert.equal(await application.evaluate(({ app }) => app.getVersion()), require('../package.json').version);
    await application.firstWindow();
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = application.windows().find(window => window.url().endsWith('/dist/index.html'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(page);
    await page.waitForSelector('.navList', { timeout: 60000 });
    const transcript = await page.evaluate(wav => window.localflow.transcribeFile({ path: wav, options: { cleanup: false, cleanupLevel: 'none' } }), wav);
    assert.match(transcript.rawText.toLowerCase(), /orange bicycle/);
    assert.equal(await application.evaluate(() => process.env.LOCALFLOW_WHISPER_MODEL || 'large-v3'), 'large-v3');
    console.log('FRESH_PROFILE_LARGE_DICTATION_OK', transcript.rawText);
    if (process.argv.includes('--smoke')) return;
    await application.evaluate(({ dialog }) => {
      globalThis.modelDialogs = [];
      dialog.showMessageBox = async options => { globalThis.modelDialogs.push(options); return { response: 1 }; };
    });
    assert.equal(await page.evaluate(() => window.localflow.setWhisperModel('base')), null);
    assert(!fs.existsSync(path.join(profile, 'runtime/models/whisper/base/model.bin')));
    assert.equal(await application.evaluate(() => globalThis.modelDialogs.length), 1);
    assert.equal(await application.evaluate(() => globalThis.modelDialogs[0].buttons[0]), 'Download this model');
    assert(!fs.existsSync(path.join(profile, '.env')) || !fs.readFileSync(path.join(profile, '.env'), 'utf8').includes('MODEL=base'));
    console.log('DOWNLOAD_CANCEL_PRESERVES_LARGE_NO_WEIGHTS_OK');
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async options => { globalThis.modelDialogs.push(options); return { response: 0 }; }; });
    const selected = await page.evaluate(() => window.localflow.setWhisperModel('base'));
    assert.equal(selected.whisperModel, 'base');
    assert(fs.statSync(path.join(profile, 'runtime/models/whisper/base/model.bin')).size > 100000000);
    assert.match(fs.readFileSync(path.join(profile, '.env'), 'utf8'), /LOCALFLOW_WHISPER_MODEL=base/);
    const downloaded = await page.evaluate(wav => window.localflow.transcribeFile({ path: wav, options: { cleanup: false, cleanupLevel: 'none' } }), wav);
    assert.match(downloaded.rawText.toLowerCase(), /orange bicycle/);
    await page.evaluate(() => window.localflow.setWhisperModel('large-v3'));
    await page.evaluate(() => window.localflow.setWhisperModel('base'));
    assert.equal(await application.evaluate(() => globalThis.modelDialogs.length), 2, 'Cached models need no download dialog');
    console.log('CONFIRMED_HF_DOWNLOAD_TRANSCRIPTION_PERSISTENCE_AND_CACHE_REUSE_OK', profile);
    await page.evaluate(() => window.localflow.setWhisperModel('large-v3'));
  } finally { await application.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
