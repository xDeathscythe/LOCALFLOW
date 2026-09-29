// Standalone design preview. No Electron bridge, network calls, microphone, or models.
const icons = {
  flow: '<path d="M4 6v8a4 4 0 0 0 8 0V6M8 18V10a4 4 0 0 1 8 0v8M20 6v8"/>',
  wave: '<path d="M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h6"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4 8.5 8.5 0 0 1 17 0Z"/><path d="M8 10h9m-9 4h6"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.3 7M3 4v7h7m2-5v6l4 2"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="3"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  landscape: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m3 17 6-6 4 4 3-3 5 5"/><circle cx="16" cy="8" r="1"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
};
function renderIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => {
    element.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[element.dataset.icon] || ''}</svg>`;
  });
}
renderIcons();

const $ = id => document.getElementById(id);
const app = document.querySelector('.app');
const storageKey = 'localflow.niwa-design-preview.v1';
const themes = ['dark', 'light', 'static-black', 'static-white'];
const sampleRaw = $('raw-text').value;
const sampleClean = $('clean-text').value;
let sample = true;
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2500);
}
function setTheme(theme) {
  if (!themes.includes(theme)) return;
  app.dataset.niwaTheme = theme;
  document.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
  try { localStorage.setItem(`${storageKey}.theme`, theme); } catch { /* Preview works without storage. */ }
}
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.theme)));
let savedTheme;
try { savedTheme = localStorage.getItem(`${storageKey}.theme`); } catch { /* Keep the default. */ }
setTheme(new URL(location.href).searchParams.get('theme') || savedTheme || 'dark');
const backgrounds = ['slate', 'moss', 'studio'];
$('backdrop-button').addEventListener('click', () => {
  document.body.dataset.backdrop = backgrounds[(backgrounds.indexOf(document.body.dataset.backdrop) + 1) % backgrounds.length];
});

const pages = { transcribe: 'Transcribe', notes: 'Notes', hermes: 'Hermes', history: 'History', settings: 'Settings' };
function navigate() {
  const view = location.hash.slice(1);
  const active = Object.hasOwn(pages, view) ? view : 'transcribe';
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== active; });
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    link.setAttribute('aria-label', pages[link.dataset.nav]);
  });
  $('page-title').textContent = pages[active];
}
window.addEventListener('hashchange', navigate);
navigate();

function updateWordCount() {
  // Native Unicode segmentation supports the transcript's language without keyword rules.
  const count = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment($('raw-text').value)].filter(part => part.isWordLike).length;
  $('word-count').textContent = `${count} words`;
  document.querySelectorAll('[data-copy="raw-text"], [data-download="raw-text"]').forEach(button => { button.disabled = !count; });
}
function updateCleanup() {
  const enabled = $('cleanup').value !== 'none';
  const hasPreview = enabled && sample && Boolean($('raw-text').value);
  $('clean-text').hidden = !hasPreview;
  $('cleanup-empty').hidden = hasPreview;
  $('clean-text').value = hasPreview ? sampleClean : '';
  $('cleanup-explanation').textContent = enabled ? 'AI cleanup is not connected in this preview. Record a sample to see the design.' : 'Turn on cleanup to preview the refined version.';
  $('cleanup-caption').textContent = enabled ? (hasPreview ? 'Meaning preserved' : 'Preview only') : 'No AI processing';
  $('cleanup-toggle').setAttribute('aria-checked', String(enabled));
  document.querySelector('[data-copy="clean-text"]').disabled = !hasPreview;
}
$('raw-text').addEventListener('input', () => { sample = false; updateWordCount(); updateCleanup(); });
$('cleanup').addEventListener('change', updateCleanup);
updateWordCount();
updateCleanup();

async function copy(text) {
  if (!text.trim()) return;
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { toast('Clipboard access is unavailable. Select the text to copy it.'); }
}
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copy($(button.dataset.copy).value)));
document.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([$(button.dataset.download).value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'localflow-preview-transcript.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));

for (let i = 0; i < 41; i++) {
  const bar = document.createElement('i');
  bar.style.setProperty('--h', `${4 + Math.abs(Math.sin(i * 1.9) * Math.sin(i * .35)) * 24}px`);
  bar.style.setProperty('--delay', `${-(i % 7) * 95}ms`);
  $('waveform').append(bar);
}
let recordingTimer;
let recordingStarted = 0;
function stopRecording(loadSample = true) {
  clearInterval(recordingTimer);
  recordingTimer = null;
  app.classList.remove('is-recording');
  $('record-button-label').textContent = 'Record';
  $('record-button').querySelector('[data-icon]').dataset.icon = 'mic';
  renderIcons($('record-button'));
  $('recording-status').textContent = loadSample ? 'Sample transcript ready' : 'Ready when you are';
  if (loadSample) {
    $('raw-text').value = sampleRaw;
    sample = true;
    $('session-name').textContent = 'A thought worth keeping';
    updateWordCount(); updateCleanup();
  }
}
$('record-button').addEventListener('click', () => {
  if (recordingTimer) { stopRecording(); return; }
  recordingStarted = Date.now();
  app.classList.add('is-recording');
  $('recording-status').textContent = 'Previewing recording…';
  $('record-button-label').textContent = 'Stop';
  $('record-button').querySelector('[data-icon]').dataset.icon = 'stop';
  renderIcons($('record-button'));
  $('recording-time').textContent = '00:00';
  recordingTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - recordingStarted) / 1000);
    $('recording-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, 250);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && recordingTimer) stopRecording(false); });
$('new-session').addEventListener('click', () => {
  stopRecording(false); sample = false;
  $('raw-text').value = ''; $('recording-time').textContent = '00:00'; $('session-name').textContent = 'Untitled session';
  updateWordCount(); updateCleanup();
  $('raw-text').focus();
});

let notes = [
  { title: 'Ideas for the new workspace', text: sampleClean },
  { title: 'Before the next call', text: 'Ask what feels slow in the current workflow.\n\nListen first. Take a short note. Leave with one clear next step.' },
  { title: 'Things to come back to', text: 'A quieter interface.\nA faster start.\nMore space for the words.' },
];
let selectedNote = 0;
try { const stored = JSON.parse(localStorage.getItem(`${storageKey}.notes`)); if (Array.isArray(stored) && stored.length && stored.every(note => typeof note.title === 'string' && typeof note.text === 'string')) notes = stored; } catch { /* Use sample notes. */ }
function persistNotes() {
  try { localStorage.setItem(`${storageKey}.notes`, JSON.stringify(notes)); } catch { toast('Notes are kept only until this page closes'); }
}
function renderNotes() {
  $('note-list').replaceChildren();
  notes.forEach((note, index) => {
    const button = document.createElement('button'); button.className = 'note-item';
    button.setAttribute('aria-pressed', String(index === selectedNote));
    const title = document.createElement('strong'); title.textContent = note.title || 'Untitled note';
    const subtitle = document.createElement('small'); subtitle.textContent = 'Personal notes';
    button.append(title, subtitle); button.addEventListener('click', () => { selectedNote = index; renderNotes(); }); $('note-list').append(button);
  });
  $('note-title').value = notes[selectedNote]?.title || '';
  $('note-body').value = notes[selectedNote]?.text || '';
  $('note-count').textContent = notes.length;
  $('note-save-status').textContent = 'Only in this preview';
}
function addNote(title = 'Untitled note', text = '') { notes.push({ title, text }); selectedNote = notes.length - 1; persistNotes(); renderNotes(); location.hash = 'notes'; }
$('new-note').addEventListener('click', () => { addNote(); $('note-title').focus(); $('note-title').select(); });
$('save-note-editor').addEventListener('click', () => { notes[selectedNote] = { title: $('note-title').value.trim() || 'Untitled note', text: $('note-body').value }; persistNotes(); renderNotes(); $('note-save-status').textContent = 'Saved in this preview'; });
[$('note-title'), $('note-body')].forEach(field => field.addEventListener('input', () => { $('note-save-status').textContent = 'Unsaved changes'; }));
$('delete-note').addEventListener('click', () => { notes.splice(selectedNote, 1); if (!notes.length) notes.push({ title: 'Untitled note', text: '' }); selectedNote = Math.max(0, selectedNote - 1); persistNotes(); renderNotes(); toast('Note removed from this preview'); });
$('save-note').addEventListener('click', () => { const text = $('clean-text').value || $('raw-text').value; if (text.trim()) { addNote($('session-name').textContent, text); toast('Saved to preview notes'); } else toast('Add a transcript first'); });
renderNotes();

const history = [
  { title: 'Ideas for the new workspace', when: 'Today, 10:42', duration: '00:28', text: sampleRaw },
  { title: 'A note before the next call', when: 'Today, 09:16', duration: '01:12', text: 'Ask what feels slow in the current workflow. Listen first, take a short note, and leave with one clear next step.' },
  { title: 'A few thoughts on the way home', when: 'Yesterday, 18:35', duration: '00:46', text: 'The best tools let me stay with the idea. Less clicking, more thinking, and enough space to change my mind.' },
];
function openHistory(index) { const item = history[index]; $('raw-text').value = item.text; $('session-name').textContent = item.title; sample = index === 0; updateWordCount(); updateCleanup(); location.hash = 'transcribe'; }
document.querySelectorAll('[data-history]').forEach(button => button.addEventListener('click', () => openHistory(Number(button.dataset.history))));
history.forEach((item, index) => {
  const row = document.createElement('button'); row.className = 'history-row';
  row.innerHTML = `<span class="file-symbol" data-icon="wave"></span><div><strong></strong><small></small></div><span>${item.duration}</span><span data-icon="arrow-up-right"></span>`;
  row.querySelector('strong').textContent = item.title; row.querySelector('small').textContent = item.when;
  row.addEventListener('click', () => openHistory(index)); $('history-list').append(row);
});
renderIcons($('history-list'));

$('copy-checklist').addEventListener('click', () => copy('Keep the transcript in focus.\nUse one clear recording control.\nMake the next step easy to find.'));
$('chat-form').addEventListener('submit', event => {
  event.preventDefault(); const message = $('chat-input').value.trim(); if (!message) return;
  const user = document.createElement('div'); user.className = 'chat-message user-message'; const text = document.createElement('p'); text.textContent = message; user.append(text); $('chat-feed').append(user);
  const answer = document.createElement('div'); answer.className = 'chat-message assistant-message'; answer.innerHTML = '<div class="assistant-name"><span class="tiny-orb"></span>Hermes</div><p>This is how a reply will look in your workspace. This design preview keeps the conversation on this page.</p><span class="chat-caption">Preview response · no AI connection</span>'; $('chat-feed').append(answer);
  $('chat-input').value = ''; $('chat-feed').scrollTop = $('chat-feed').scrollHeight;
});
$('model').addEventListener('change', () => { $('model-status').textContent = $('model').value; toast('Model selection preview updated'); });
$('hold-toggle').addEventListener('click', () => {
  const enabled = $('hold-toggle').getAttribute('aria-checked') !== 'true'; $('hold-toggle').setAttribute('aria-checked', String(enabled));
  $('recording-hint').innerHTML = `${enabled ? 'Hold' : 'Press'} <kbd>Ctrl</kbd> + <kbd>Shift</kbd> to speak`;
});
$('cleanup-toggle').addEventListener('click', () => { $('cleanup').value = $('cleanup-toggle').getAttribute('aria-checked') === 'true' ? 'none' : 'light'; updateCleanup(); });
