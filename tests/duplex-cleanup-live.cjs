// Opt-in Live1 integration: synthetic text only, no microphone or audio playback.
const { app, BrowserWindow } = require('electron');
const { join, resolve } = require('node:path');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const { createDuplexCleanup } = require('../electron/duplex-cleanup.cjs');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'localflow-duplex-test-')));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const cleanup = createDuplexCleanup({ BrowserWindow, binary: () => resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'), directory: join(process.env.APPDATA, 'localflow') });
  try {
    for (const [text, language, required, action] of [
      ['hello this is test number 42 please keep the number', 'English', '42', 'dictate'],
      ['ovo je test broj 42 hvala puno', 'Serbian Latin', '42', 'dictate'],
      ['今日は良い天気です', 'Japanese', '天気', 'dictate'],
      ['Prevedi na engleski: Imam 42 knjige.', 'Serbian Latin', '42', 'translate'],
    ]) {
      const started = Date.now();
      const result = await cleanup.clean({ prompt: `Return a compact JSON header with action and target_language, then a newline and the cleaned text as plain text. Correct punctuation and grammar without changing meaning. Preserve ${language}. If the transcript explicitly asks for translation, translate only its content, set action translate and target_language to the requested language. Otherwise use action dictate, target_language null. Transcript:\n${text}`, timeout: 40 });
      assert.equal(result.action, action); assert(result.text.includes(required));
      console.log(JSON.stringify({ language, elapsedMs: Date.now() - started, result }));
    }
    console.log('DUPLEX_CLEANUP_LIVE_OK'); cleanup.close(); app.exit(0);
  } catch (error) { console.error(error); cleanup.close(); app.exit(1); }
});
