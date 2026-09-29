// Opt-in service test: synthetic screen/audio only, no desktop capture or microphone.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { resolveNiwaCodexBinary } = require('../electron/runtime-config.cjs');
const codex = require('../electron/codex-client.cjs');
// Requires explicit authorization for this service test. Never enable by default.
// Hold the existing access token in memory without copying credentials,
// refreshing the owner's login, or changing the live conversation.
if (process.env.LOCALFLOW_SCREEN_TEST_USE_EXISTING_LOGIN === '1') codex.CodexClient = class extends codex.CodexClient {
  async initialize() {
    await super.initialize();
    const auth = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'localflow/niwa/codex/auth.json'), 'utf8'));
    await this.request('account/login/start', { type: 'chatgptAuthTokens', accessToken: auth.tokens.access_token, chatgptAccountId: auth.tokens.account_id });
  }
};
const directory = path.resolve('runtime/niwa-screen-live', String(Date.now()));
fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', directory);
const wait = async (check, label) => {
  const deadline = Date.now() + 90_000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
app.whenReady().then(async () => {
  let agent, voiceWindow, fixture, synthesizer;
  try {
    fixture = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { backgroundThrottling: false } });
    await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#102030;color:white;font:64px Arial;padding:60px"><h1>COBALT 47</h1><p>Two orange circles</p><div style="display:flex;gap:40px"><i style="background:orange;width:100px;height:100px;border-radius:50%"></i><i style="background:orange;width:100px;height:100px;border-radius:50%"></i></div></body>'));
    const frame = await fixture.webContents.capturePage();
    assert(!frame.isEmpty());
    let captures = 0;
    const { createNiwaAgent } = await import('../electron/niwa-agent.mjs');
    agent = createNiwaAgent({ directory, appRoot: path.resolve('.'), binary: resolveNiwaCodexBinary, speak: async () => {},
      captureScreen: async () => { captures++; return { content: [{ type: 'image', mimeType: 'image/png', data: frame.toPNG().toString('base64') }], details: {} }; },
      notify: event => {
        if (event.type === 'sdp') voiceWindow?.webContents.send('sdp', event.sdp);
        if (event.type === 'error') console.log('NIWA_ERROR', event.message);
      },
    });
    await agent.configure({ access: 'read' });
    await agent.connect();
    voiceWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve('tests/niwa-voice-preload.cjs'), backgroundThrottling: false } });
    ipcMain.handle('voice-test-start', (_event, sdp) => agent.startVoice(sdp));
    await voiceWindow.loadFile(path.resolve('tests/niwa-voice-test.html'));
    await voiceWindow.webContents.executeJavaScript('window.startTest()');
    await wait(() => voiceWindow.webContents.executeJavaScript("window.voiceState === 'connected'"), 'voice connection');
    console.log('SCREEN_TEST_VOICE_CONNECTED');
    const { createVoiceOutputManager } = require('../electron/voice-output.cjs');
    synthesizer = createVoiceOutputManager(path.resolve('.'));
    const speech = await synthesizer.speak('piper', 'Please look at my screen now. Take a screenshot and tell me the large heading and the color of the circles you can see.', { play: false });
    await voiceWindow.webContents.executeJavaScript(`window.speakTest(${JSON.stringify(fs.readFileSync(speech.wav).toString('base64'))})`);
    await wait(() => captures > 0, 'spoken request calls screenshot tool');
    await wait(() => agent.snapshot().messages.some(message => message.role === 'assistant' && /cobalt/i.test(message.content) && /47/.test(message.content)), 'vision-grounded answer');
    assert(agent.snapshot().voice, 'Voice remains online');
    assert.equal(agent.snapshot().approvals.length, 0);
    console.log('NIWA_SCREEN_REALTIME_LIVE_OK: spoken request → screenshot tool → image-grounded answer, voice stays online');
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ captures, voice: true, syntheticScreen: true, model: agent.snapshot().settings.model }));
    await agent.stopVoice();
    await voiceWindow.webContents.executeJavaScript('window.endTest()');
    await agent.close(); agent = null;
    synthesizer.stop(); synthesizer = null;
    fixture.destroy(); voiceWindow.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error); synthesizer?.stop(); await agent?.close(); fixture?.destroy(); voiceWindow?.destroy(); app.exit(1);
  }
});
