void window.__TAURI__.event.listen('recording-state', ({payload}) => {
  const meeting = !payload.recording && !payload.starting ? payload.meeting?.active : null;
  const seconds = Math.floor(meeting ? meeting.elapsedMs / 1000 : payload.elapsedSeconds || 0);
  document.querySelector('output').textContent = payload.starting ? '•••' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`;
  const button = document.querySelector('button');
  button.setAttribute('aria-label', meeting ? 'Finish meeting' : 'Stop dictation');
  button.title = meeting ? `${meeting.state === 'paused' ? 'Paused' : 'Recording'} meeting — finish` : 'Stop dictation';
  button.classList.toggle('paused', meeting?.state === 'paused');
}).then(() => window.__TAURI__.core.invoke('native_call', {method:'recording-ready',args:[]}));
document.querySelector('button').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await window.__TAURI__.core.invoke('native_call', {method:'recording-stop',args:[]}); }
  catch (error) { button.title = String(error); }
  finally { button.disabled = false; }
});
