const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron } = require('playwright');

// Use a fresh profile, only Windows on PATH, no developer environment or network.
const executable = path.resolve(process.argv[2] || 'release/windows/win-unpacked/LocalFlow.exe');
const resources = path.join(path.dirname(executable), 'resources');
const directory = fs.mkdtempSync(path.resolve('runtime/windows-install-'));
const profile = path.join(directory, 'profile');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(LOCALFLOW_|PYTHON|HF_|HUGGINGFACE_|TRANSFORMERS_|CODEX_|VITE_|ELECTRON_)/i.test(key)));
Object.assign(env, { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, PYTHONNOUSERSITE: '1',
  HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
  HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', TEMP: directory, TMP: directory });

async function main() {
  for (const relative of ['runtime/tts/shared/refs', 'assets/tts/refs', '.env', 'auth.json'])
    assert(!fs.existsSync(path.join(resources, relative)), `Private file shipped: ${relative}`);
  const wav = path.join(directory, 'speech.wav');
  const piper = path.join(resources, 'runtime/tts/piper');
  const result = spawnSync(path.join(piper, '.venv/Scripts/python.exe'), ['-B', '-c',
    `from piper import PiperVoice\nimport wave\nv=PiperVoice.load(${JSON.stringify(path.join(piper, 'voices/en_US-kristin-medium.onnx'))})\nwith wave.open(${JSON.stringify(wav)},'wb') as f: v.synthesize_wav('The orange bicycle is next to the library.', f)`],
    { cwd: directory, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  console.log('PACKAGED_PIPER_OFFLINE_OK');
  const application = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], cwd: directory, env, timeout: 60000 });
  try {
    const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), profile: app.getPath('userData') }));
    assert(identity.packaged);
    assert.equal(identity.version, require('../package.json').version);
    assert.equal(identity.profile.toLowerCase(), profile.toLowerCase());
    // Observe startup before spending time on other bundled tools.
    await application.evaluate(({ BrowserWindow }) => {
      globalThis.testWorkerProgress = [];
      for (const window of BrowserWindow.getAllWindows()) {
        const send = window.webContents.send.bind(window.webContents);
        window.webContents.send = (channel, ...args) => {
          if (channel === 'worker-progress') globalThis.testWorkerProgress.push(args[0]);
          return send(channel, ...args);
        };
      }
    });
    await application.evaluate(async ({ app }) => {
      const { chromium } = process.mainModule.require('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const tab = await browser.newPage();
        await tab.setContent('<title>Bundled browser ready</title>');
        if (await tab.title() !== 'Bundled browser ready') throw new Error('Bundled browser failed');
      } finally { await browser.close(); }
    });
    console.log('PACKAGED_BROWSER_NO_EXTERNAL_INSTALL_OK');
    await application.firstWindow();
    let page;
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
      page = application.windows().find(window => window.url().endsWith('/dist/index.html'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(page, `Main window missing: ${application.windows().map(window => window.url()).join(', ')}`);
    await page.waitForSelector('.navList', { timeout: 60000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('localflow.cleanup-level.v1')), null);
    for (let attempt = 0; attempt < 600; attempt++) {
      const ready = await application.evaluate(() => globalThis.testWorkerProgress.some(event => event.stage === 'whisper-ready' && event.action === 'warmup'));
      if (ready) break;
      assert(attempt < 599, 'Startup must fully warm Whisper without recording or Codex login');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (process.argv.includes('--installed')) {
      assert.match(fs.readFileSync(path.join(path.dirname(executable), 'setup.log'), 'utf8'), /LOCALFLOW_SETUP_READY/);
      const modules = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-Command', `(Get-Process -Id ${await application.evaluate(() => process.pid)}).Modules.FileName`],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      assert.equal(modules.status, 0, modules.stderr);
      assert(!modules.stdout.toLowerCase().includes('translucent-windows'), 'Windhawk must not override the installed app');
      console.log('INSTALLED_SETUP_WARMUP_WINDHAWK_EXCLUSION_OK');
    }
    const started = Date.now();
    const transcript = await page.evaluate(async wav => window.localflow.transcribeFile({ path: wav, options: { cleanup: false, cleanupLevel: 'none' } }), wav);
    const firstMs = Date.now() - started;
    assert(!(await application.evaluate(() => globalThis.testWorkerProgress.some(event => event.action === 'transcribe' && event.stage === 'loading-whisper'))), 'First dictation must reuse the warm model');
    const secondStarted = Date.now();
    await page.evaluate(async wav => window.localflow.transcribeFile({ path: wav, options: { cleanup: false, cleanupLevel: 'none' } }), wav);
    console.log('PACKAGED_STARTUP_WARM_FIRST_TRANSCRIPT_OK', JSON.stringify({ firstMs, secondMs: Date.now() - secondStarted }));
    assert.match(transcript.rawText.toLowerCase(), /orange bicycle/);
    assert.match(transcript.rawText.toLowerCase(), /library/);
    assert.equal((await page.evaluate(() => window.localflow.getCleanupAuthStatus())).connected, false);
    assert((await page.evaluate(() => window.localflow.getVoiceOutputConfig())).options.find(item => item.id === 'piper').available);
    // Start the real packaged Codex OAuth flow, but capture the browser URL locally.
    await application.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.testAuthUrl = url; }; });
    assert.equal((await page.evaluate(() => window.localflow.connectCleanupWithCodex())).busy, true);
    assert.equal(new URL(await application.evaluate(() => globalThis.testAuthUrl)).protocol, 'https:');
    await page.evaluate(() => window.localflow.cancelCleanupConnection());
    await page.screenshot({ path: path.join(directory, 'installed.png') });
    console.log('PACKAGED_FRESH_PROFILE_CPU_VTT_NO_ACCOUNT_OAUTH_OK', JSON.stringify({ ...identity, transcript: transcript.rawText }));
  } finally { await application.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
