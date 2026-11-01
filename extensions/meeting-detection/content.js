(() => {
  if (window !== window.top) return;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'localflow-rtc-v1') return;
    const value = event.data;
    if (!['connected', 'ended'].includes(value.state) || typeof value.callId !== 'string' || value.callId.length > 100
      || typeof value.pageId !== 'string' || value.pageId.length > 100 || !Number.isSafeInteger(value.sequence)) return;
    // No page content, microphone data, title, or credential crosses this channel.
    chrome.runtime.sendMessage({ type: 'rtc-state', state: value.state, pageId: value.pageId, callId: value.callId,
      sequence: value.sequence, observedAt: value.observedAt, inboundPackets: value.inboundPackets, outboundPackets: value.outboundPackets })
      .catch(() => {});
  });
})();
