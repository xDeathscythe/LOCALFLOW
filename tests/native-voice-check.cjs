const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
module.exports=async function checkVoice(page){
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/niwa.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const result = await page.evaluate(`(async () => {
      const exports = {};
      ${source}
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const NativePeer = RTCPeerConnection, NativeAudio = Audio, originalApi=window.localflow, mediaDescriptor=Object.getOwnPropertyDescriptor(navigator,"mediaDevices");
      // Synthetic duplex audio only: no microphone, speakers, network service or API key.
      window.Audio = class extends NativeAudio { constructor() { super(); this.muted = true; } };
      let local, stops = 0;
      const remote = new NativePeer();
      window.RTCPeerConnection = class extends NativePeer {
        constructor() { super(); local = this; this.onicecandidate = event => { if (event.candidate) void remote.addIceCandidate(event.candidate); }; }
      };
      remote.onicecandidate = event => { if (event.candidate) void local.addIceCandidate(event.candidate); };
      const context = new AudioContext(), output = context.createMediaStreamDestination();
      const tone = context.createOscillator(); tone.connect(output); tone.start(); await context.resume();
      remote.addTrack(output.stream.getAudioTracks()[0], output.stream);
      let captured;
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
        const input = context.createMediaStreamDestination(); tone.connect(input); captured = input.stream; return captured;
      } } });
      const errors = [], voice = new exports.NiwaVoice(message => errors.push(message));
      window.localflow = {
        niwaStopVoice: async () => { stops++; },
        niwaStartVoice: async sdp => {
          await remote.setRemoteDescription({ type: 'offer', sdp });
          await remote.setLocalDescription(await remote.createAnswer());
          await voice.answer(remote.localDescription.sdp);
        },
      };
      await voice.start(); await voice.setMicrophoneEnabled(true);
      const stats = async () => {
        const report = await local.getStats(); let sent = 0, received = 0;
        report.forEach(item => { if (item.type === 'outbound-rtp') sent += item.packetsSent; if (item.type === 'inbound-rtp') received += item.packetsReceived; });
        return { sent, received };
      };
      for (let i = 0; i < 50 && !(await stats()).received; i++) await wait(100);
      await wait(300);
      await voice.setMicrophoneEnabled(false);
      await wait(500); const before = await stats(); await wait(700); const after = await stats();
      const senderTrack = local.getSenders()[0].track;
      let silent = false;
      if (senderTrack) {
        const analyser = context.createAnalyser();
        const input = context.createMediaStreamSource(new MediaStream([senderTrack])); input.connect(analyser);
        await wait(80); const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        silent = samples.every(value => value === 0); input.disconnect();
      }
      const result = { before, after, silent, stopped: captured.getTracks().every(track => track.readyState === 'ended'), stops, errors };
      await voice.setMicrophoneEnabled(true);
      result.resumed = local.getSenders()[0].track === captured.getAudioTracks()[0];
      voice.close(); remote.close(); await context.close(); window.Audio=NativeAudio;window.RTCPeerConnection=NativePeer;window.localflow=originalApi;if(mediaDescriptor)Object.defineProperty(navigator,"mediaDevices",mediaDescriptor);else delete navigator.mediaDevices;return result;
    })()`);
    assert(result.stopped, 'Release closes actual capture');
    assert(result.after.sent > result.before.sent, `Release must keep sending silence, not stop RTP: ${JSON.stringify(result)}`);
    assert(result.silent, 'Released input contains only digital silence');
    assert(result.after.received > result.before.received, 'Incoming agent audio continues after release');
    assert(result.resumed, 'Next hold reconnects fresh input');
    assert.equal(result.stops, 0); assert.deepEqual(result.errors, []);
    console.log('NIWA_DUPLEX_AUDIO_OK: mic closed, silent RTP continues, agent audio received, next hold resumes');

};
