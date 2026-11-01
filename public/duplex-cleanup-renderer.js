// A synthetic silent track clocks Live1's duplex transport. No microphone or playback.
let peer, context, oscillator;
let finish, fail, result, connected, connectionFailed;
const ready = new Promise((resolve, reject) => { connected = resolve; connectionFailed = reject; });
void ready.catch(() => {});
window.cleanupTransport = {
  get result() { return result; }, ready,
  startResponse: () => {
    result = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    void result.catch(() => {});
  },
  offer: async () => {
    peer = new RTCPeerConnection();
    context = new AudioContext();
    const destination = context.createMediaStreamDestination(), silence = context.createGain();
    silence.gain.value = 0;
    oscillator = context.createOscillator(); oscillator.connect(silence).connect(destination); oscillator.start();
    peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') connected();
      if (peer.connectionState === 'failed') { connectionFailed(new Error('Live1 connection failed.')); fail?.(new Error('Live1 connection failed.')); }
    };
    peer.createDataChannel('oai-events').onmessage = event => {
      let value;
      try { value = JSON.parse(event.data); } catch { return; }
      if (value.type === 'turn.done' && value.turn?.role === 'assistant' && finish) { finish(value.turn.transcript); finish = null; }
      if (value.type === 'error') fail?.(new Error(value.error?.message || 'Live1 cleanup failed.'));
    };
    await peer.setLocalDescription(await peer.createOffer());
    return peer.localDescription.sdp;
  },
  answer: sdp => peer.setRemoteDescription({ type: 'answer', sdp }),
};
