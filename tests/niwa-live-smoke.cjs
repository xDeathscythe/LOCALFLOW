const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { resolveNiwaCodexBinary } = require('../electron/runtime-config.cjs');
const directory = path.resolve('runtime/niwa-verification', String(Date.now()));
fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', directory);
const wait = async (predicate, label, timeout = 90_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
};
app.whenReady().then(async () => {
  let agent, window;
  const events = [];
  try {
    const { createNiwaAgent } = await import('../electron/niwa-agent.mjs');
    agent = createNiwaAgent({ directory, appRoot: path.resolve('.'), binary: resolveNiwaCodexBinary, speak: async () => {}, notify: event => {
      events.push(event);
      if (event.type === 'sdp') window?.webContents.send('sdp', event.sdp);
      if (event.type === 'error') console.log('NIWA_ERROR', event.message);
    } });
    const connected = await agent.connect();
    assert(connected.models.length > 0);
    console.log('MODELS_OK', connected.models.map(model => model.model).join(', '));
    await agent.send('This is an isolated integration test. Use companion_memory_capture to remember category user_preference, fact "Integration test prefers concise replies". Then call companion_memory_recall and report LOCALFLOW_NIWA_OK if that fact is present. Do not change other files or run any shell commands.');
    await wait(() => !agent.snapshot().busy, 'agent response');
    assert(agent.snapshot().memory.active_facts > 0, 'real Codex tool call persisted memory');
    assert(agent.snapshot().messages.some(message => message.role === 'assistant' && message.content.includes('LOCALFLOW_NIWA_OK')));
    console.log('CODEX_TOOL_MEMORY_OK');
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve('tests/niwa-voice-preload.cjs'), contextIsolation: true, nodeIntegration: false } });
    ipcMain.handle('voice-test-start', (_event, sdp) => agent.startVoice(sdp));
    await window.loadFile(path.resolve('tests/niwa-voice-test.html'));
    await window.webContents.executeJavaScript(`window.startTest()`);
    await wait(() => window.webContents.executeJavaScript(`window.voiceState === 'connected'`), 'duplex WebRTC connection', 60_000);
    console.log('CODEX_REALTIME_V3_WEBRTC_CONNECTED');
    const { createVoiceOutputManager } = require('../electron/voice-output.cjs');
    const synthesizer = createVoiceOutputManager(path.resolve('.'));
    let speech;
    try { speech = await synthesizer.speak('piper', 'Please save this to your permanent memory. My favorite test color is purple.', { play: false }); }
    finally { synthesizer.stop(); }
    await window.webContents.executeJavaScript(`window.speakTest(${JSON.stringify(fs.readFileSync(speech.wav).toString('base64'))})`);
    await wait(() => Object.values(agent.snapshot().memory.documents).flat().some(fact => fact.fact.toLowerCase().includes('purple')), 'spoken voice to Codex tool handoff', 90_000);
    console.log('DUPLEX_CODEX_TOOL_HANDOFF_OK');
    await wait(() => !agent.snapshot().busy, 'voice handoff completion');
    await agent.stopVoice();
    const voiceMessages = agent.snapshot().messages;
    assert.equal(voiceMessages.filter(message => message.role === 'user' && message.content.includes('purple')).length, 1, 'voice transcript is stored once');
    await window.webContents.executeJavaScript(`window.endTest()`);
    await agent.close();
    agent = createNiwaAgent({ directory, appRoot: path.resolve('.'), binary: resolveNiwaCodexBinary, speak: async () => {}, notify: () => {} });
    assert(agent.snapshot().memory.active_facts > 0);
    assert(agent.snapshot().messages.length >= 2);
    await agent.connect();
    console.log('NIWA_RESUME_AND_MEMORY_OK');
    await agent.close(); agent = null; window.destroy(); window = null;
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ models: connected.models.map(model => model.model), memory: true, resume: true, realtimeWebRTC: true }, null, 2));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  finally { await agent?.close(); window?.destroy(); }
});
