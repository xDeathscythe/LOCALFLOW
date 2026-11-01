(() => {
  const Native = window.RTCPeerConnection;
  if (!Native || window !== window.top) return;
  const peers = new Set(), pageId = crypto.randomUUID();
  let callId = null, sequence = 0, announcedAt = 0, lostAt = 0, polling = false;
  let previous = { incoming: 0, outgoing: 0 }, lastIncoming = 0, lastOutgoing = 0;
  const send = state => {
    if (!callId) return;
    window.postMessage({ source: 'localflow-rtc-v1', state, pageId, callId, sequence: ++sequence,
      observedAt: Date.now(), inboundPackets: previous.incoming, outboundPackets: previous.outgoing }, location.origin);
    announcedAt = Date.now();
  };
  async function inspect() {
    if (polling) return;
    polling = true;
    try {
      let incoming = 0, outgoing = 0, connected = 0;
      for (const peer of peers) {
        if (peer.connectionState === 'closed') { peers.delete(peer); continue; }
        if (peer.connectionState !== 'connected' && !['connected', 'completed'].includes(peer.iceConnectionState)) continue;
        let stats;
        try { stats = await peer.getStats(); } catch { continue; }
        let audio = false;
        for (const report of stats.values()) {
          if (report.kind !== 'audio' && report.mediaType !== 'audio') continue;
          if (report.type === 'inbound-rtp') { incoming += Number(report.packetsReceived) || 0; audio = true; }
          if (report.type === 'outbound-rtp') { outgoing += Number(report.packetsSent) || 0; audio = true; }
        }
        if (audio) connected++;
      }
      const now = Date.now();
      if (incoming > previous.incoming) lastIncoming = now;
      if (outgoing > previous.outgoing) lastOutgoing = now;
      previous = { incoming, outgoing };
      // Voice notes use MediaRecorder, not a connected, two-way audio RTP transport.
      if (!callId && connected && incoming > 0 && outgoing > 0 && now-lastIncoming < 8000 && now-lastOutgoing < 8000) {
        callId = crypto.randomUUID(); sequence = 0; lostAt = 0; send('connected');
      } else if (callId && connected) {
        lostAt = 0;
        if (now-announcedAt >= 5000) send('connected');
      } else if (callId && peers.size === 0) {
        lostAt ||= now;
        if (now-lostAt >= 5000) { send('ended'); callId = null; lastIncoming = 0; lastOutgoing = 0; }
      } else {
        // A disconnected/failed transport may reconnect. Let the host mark an expired
        // signal, rather than claiming that the user ended the call and stopping audio.
        lostAt = 0;
      }
    } finally { polling = false; }
  }
  window.RTCPeerConnection = new Proxy(Native, {
    construct(target, args, newTarget) {
      const peer = Reflect.construct(target, args, newTarget);
      peers.add(peer);
      peer.addEventListener('connectionstatechange', () => { void inspect(); });
      return peer;
    },
  });
  const timer = setInterval(() => { if (peers.size || callId) void inspect(); }, 1000);
  window.addEventListener('pagehide', () => { send('ended'); clearInterval(timer); }, { once: true });
})();
