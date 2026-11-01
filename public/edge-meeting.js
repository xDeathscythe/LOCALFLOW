(() => {
  const panel = document.querySelector('.meeting-panel');
  const sheet = document.querySelector('.meeting-sheet');
  const silhouette = document.querySelector('.silhouette path');
  const buttons = [...panel.querySelectorAll('[data-meeting]')];
  let state = {}, busy = false, layout = '', clipFrame = 0, until = 0, lastRegion = '', pendingRegion = null, clipping = false;
  async function sendRegion(region) {
    pendingRegion = region;
    if (clipping) return;
    clipping = true;
    try {
      while (pendingRegion) {
        const next = pendingRegion; pendingRegion = null;
        await window.edge.region(next);
      }
    } catch (error) { lastRegion = ''; console.error(error); }
    finally { clipping = false; }
  }
  const duration = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`; };
  // Match the painted shape for mouse routing; native window bounds only change at morph boundaries.
  function clip() {
    const transform = silhouette.getScreenCTM(), length = silhouette.getTotalLength();
    const polygon = Array.from({length:96}, (_, index) => {
      const point = silhouette.getPointAtLength(length * index / 96).matrixTransform(transform);
      return [Math.round(point.x * 2) / 2, Math.round(point.y * 2) / 2];
    });
    const rect = sheet.getBoundingClientRect();
    const visible = Number(getComputedStyle(sheet).opacity) > .01;
    const region = {polygon,sheet:visible ? {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,radiusX:36 * rect.width / 320,radiusY:36} : null};
    const encoded = JSON.stringify(region);
    if (encoded !== lastRegion) { lastRegion = encoded; void sendRegion(region); }
    clipFrame = performance.now() < until ? requestAnimationFrame(clip) : 0;
  }
  function animateClip() { until = performance.now() + 700; if (!clipFrame) clipFrame = requestAnimationFrame(clip); }
  window.addEventListener('resize', animateClip);
  window.addEventListener('meeting-edge-state', ({detail}) => {
    state = detail.meeting || {};
    const active = state.active, offer = state.offer;
    const expanded = Boolean(detail.meetingExpanded);
    document.body.classList.toggle('meeting-expanded', expanded);
    panel.inert = !expanded;
    document.querySelector('#meeting-title').textContent = offer ? 'Transcribe meeting?' : active?.state === 'paused' ? 'Meeting paused' : active?.state === 'recording' ? 'Recording meeting' : 'Saving meeting';
    document.querySelector('#meeting-detail').textContent = offer?.title || offer?.application || active?.title || 'Microphone and call audio';
    document.querySelector('#meeting-time').textContent = active ? duration(active.elapsedMs) : '';
    document.querySelector('#meeting-error').textContent = active?.errors?.at(-1) || '';
    const shown = offer ? ['accept','decline'] : active?.state === 'recording' ? ['pause','mute','stop'] : active?.state === 'paused' ? ['resume','mute','stop'] : active?.noteId ? ['open-note'] : [];
    for (const button of buttons) {
      button.hidden = !shown.includes(button.dataset.meeting);
      button.disabled = busy;
    }
    const mute = panel.querySelector('[data-meeting=mute]');
    mute.textContent = active?.muted ? 'Unmute' : 'Mute mic'; mute.setAttribute('aria-pressed',String(Boolean(active?.muted)));
    panel.querySelector('.meeting-source').hidden = Boolean(active);
    const nextLayout = `${expanded}:${detail.expanded}:${innerWidth}:${innerHeight}`;
    if (nextLayout !== layout) { layout = nextLayout; animateClip(); }
  });
  for (const button of buttons) button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; buttons.forEach(button => { button.disabled = true; });
    try {
      if (button.dataset.meeting === 'accept' && !state.offer?.processId) await window.edge.action('transcribe');
      else await window.edge.meeting({action:button.dataset.meeting,muted:!state.active?.muted,id:state.active?.id});
    }
    catch (error) { document.querySelector('#meeting-error').textContent = String(error); await window.edge.action('transcribe'); }
    finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
  });
  panel.querySelector('.meeting-source').addEventListener('click', () => window.edge.action('transcribe'));
  animateClip();
})();
