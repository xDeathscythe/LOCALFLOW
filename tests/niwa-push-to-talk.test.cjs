const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'localflow-ptt-')));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let window;
  try {
    let starts = 0, stops = 0;
    let edgeState;
    ipcMain.on('test-recording-state', (_event, state) => { edgeState = state; });
    let saves = 0, transcriptions = 0, pasted = [];
    ipcMain.handle('test-save-audio', () => { saves++; return 'dictation.webm'; });
    ipcMain.handle('test-transcribe', () => { transcriptions++; return { rawText: 'Dictation while Niwa works.', polishedText: '', duration: 1 }; });
    ipcMain.handle('test-paste', (_event, text) => { pasted.push(text); });
    ipcMain.handle('test-niwa-start', () => {
      starts++;
      window.webContents.send('test-niwa-event', { type: 'voice', active: true });
    });
    ipcMain.handle('test-niwa-stop', () => {
      stops++;
      window.webContents.send('test-niwa-event', { type: 'voice', active: false });
    });
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'settings-ui-preload.cjs'), backgroundThrottling: false, additionalArguments: ['--niwa-dictation-check'] } });
    const run = script => window.webContents.executeJavaScript(script).catch(error => { throw new Error(`${error.message}\nWhile executing: ${script.slice(0,160)}`); });
    window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
    const until = async (check, label) => {
      const deadline = Date.now() + 5000;
      while (!(await check())) { assert(Date.now() < deadline, label); await pause(10); }
    };
    const hotkey = (event, action = 'niwa-agent') => window.webContents.send('test-hotkey', { type: 'hotkey', action, event });
    await window.loadFile(path.resolve('dist/index.html'));
    await until(() => run("Boolean(document.querySelector('.niwaTalk'))"), 'Niwa mounted');
    // No real microphone, network, API credentials, or synthesized speech.
    await run(`
      window.testTracks = []; window.testPeers = []; window.micDelay = 0; window.micRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.micRequests++;
        await new Promise(resolve => setTimeout(resolve, window.micDelay));
        const track = { kind: 'audio', enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
        window.testTracks.push(track);
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      };
      window.RTCPeerConnection = class {
        constructor() { this.signalingState = 'stable'; this.connectionState = 'new'; window.testPeers.push(this); }
        addTransceiver() { this.sender = { track: null, replaceTrack: async track => { this.sender.track = track; } }; return { sender: this.sender }; }
        createDataChannel() { return {}; }
        async createOffer() { return { type: 'offer', sdp: 'v=0\\r\\n' }; }
        async setLocalDescription(sdp) { this.localDescription = sdp; this.signalingState = 'have-local-offer'; }
        async setRemoteDescription() { this.signalingState = 'stable'; }
        close() { this.connectionState = 'closed'; }
      };
      window.MediaRecorder = class {
        constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          this.ondataavailable({ data: new Blob(['recorded audio'], { type: this.mimeType }) });
          this.onstop();
        }
      };
      void 0;
    `);
    const listening = () => run("document.querySelector('.niwaTalk').getAttribute('aria-pressed') === 'true'");
    const micClosed = () => run("window.testTracks.every(track => track.readyState === 'ended') && document.querySelector('.niwaTalk').getAttribute('aria-pressed') === 'false'");
    const endVoice = async () => {
      await run("[...document.querySelectorAll('.niwaVoiceBar button')].find(button => button.textContent.includes('End voice')).click()");
      await until(() => run("![...document.querySelectorAll('.niwaVoiceBar button')].some(button => button.textContent.includes('End voice'))"), 'Voice ended');
    };

    window.webContents.send('test-edge-action', 'agent');
    await pause(50);
    assert.equal(await run('window.micRequests'), 0, 'Opening the agent page cannot open the microphone');
    hotkey('pressed');
    await until(listening, 'Hold opens capture');
    await until(() => edgeState?.agentListening === true, 'Actual Niwa capture reaches the edge panel');
    hotkey('pressed');
    await pause(30);
    assert.equal(await run('window.micRequests'), 1, 'Repeated press cannot toggle or reacquire');
    hotkey('released');
    await until(micClosed, 'Release stops all microphone tracks');
    await until(() => edgeState?.agentListening === false, 'Release clears listening while voice remains connected');
    assert.equal(starts, 1);
    assert.equal(stops, 0, 'Release keeps conversation running');
    assert.equal(await run('window.testPeers[0].connectionState'), 'new', 'Release leaves peer open');
    window.webContents.send('test-niwa-event', { type: 'busy', busy: true });
    window.webContents.send('test-niwa-event', { type: 'message', id: 'reply', role: 'assistant', content: 'Work continues with the microphone off.', timestamp: Date.now() });
    await until(() => run("document.querySelector('.niwaTranscript').textContent.includes('Work continues')"), 'Background reply arrives while muted');
    assert(await micClosed());
    hotkey('pressed');
    await until(listening, 'Next hold reacquires microphone');
    assert.equal(starts, 1, 'Second hold reuses the voice session');
    hotkey('released');
    await until(micClosed, 'Second release stops capture');

    await run('window.micDelay = 200');
    hotkey('pressed');
    await until(() => run('window.micRequests === 3'), 'Delayed capture requested');
    hotkey('released');
    await pause(250);
    assert(await micClosed(), 'Late microphone result cannot reopen capture');
    assert.equal(stops, 0);
    await endVoice();
    assert.equal(stops, 1, 'Only explicit End voice stops session');

    // The same race on first connection.
    hotkey('pressed');
    await until(() => run('window.micRequests === 4'), 'First-session capture requested');
    hotkey('released');
    await pause(250);
    assert(await micClosed(), 'Release during initial connection is respected');
    await endVoice();
    window.webContents.send('test-niwa-event', { type: 'busy', busy: false });
    await run('window.micDelay = 0');

    await run("document.querySelector('.niwaTalk').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))");
    await until(listening, 'Accessible hold button opens microphone');
    await run("document.querySelector('.niwaTalk').dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))");
    await until(micClosed, 'Accessible hold button releases microphone');
    await run("document.querySelector('.niwaTalk').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))");
    await until(listening, 'Button can be held again');
    await run("window.dispatchEvent(new Event('blur'))");
    await until(micClosed, 'Lost focus releases the button');
    window.webContents.send('test-niwa-event', { type: 'busy', busy: true });
    const sessionStarts = starts, sessionStops = stops;
    const requests = await run('window.micRequests');
    hotkey('pressed', 'dictation');
    await until(() => run('window.micRequests') .then(count => count === requests + 1), 'Dictation acquires mic while Niwa is online and busy');
    await until(() => edgeState?.recording === true, 'Dictation recording reaches the edge panel');
    assert.equal(edgeState.recordingTarget, 'microphone');
    assert.equal(edgeState.agentListening, false);
    hotkey('pressed');
    hotkey('released');
    await pause(50);
    assert.equal(await run('window.micRequests'), requests + 1, 'Agent cannot capture a microphone owned by dictation');
    hotkey('released', 'dictation');
    await until(() => Promise.resolve(pasted.length === 1), 'Dictation is transcribed and pasted while Niwa works');
    assert.equal(pasted[0], 'Dictation while Niwa works.');
    assert.equal(saves, 1); assert.equal(transcriptions, 1);
    assert.equal(starts, sessionStarts); assert.equal(stops, sessionStops);
    await until(micClosed, 'Dictation releases its capture');
    hotkey('pressed');
    await until(listening, 'Niwa reacquires after dictation');
    hotkey('pressed', 'dictation');
    await pause(30);
    assert.equal(await run('window.micRequests'), requests + 2, 'Dictation cannot capture while Niwa keys are held');
    hotkey('released', 'dictation');
    assert(await listening(), 'Releasing dictation keys cannot mute Niwa');
    hotkey('released');
    await until(micClosed, 'Niwa releases its capture again');
    assert.equal(starts, sessionStarts, 'Dictation handoff preserves voice session');
    await endVoice();
    console.log('NIWA_PUSH_TO_TALK_UI_OK: hold/release, repeats, background replies, reconnect, late capture, keyboard, focus loss, dictation/transcription/paste while busy, exclusive microphone handoff');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
