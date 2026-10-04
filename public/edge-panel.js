const controls = document.querySelector('.controls');
const buttons = [...controls.querySelectorAll('button')];
let selected = 'microphone';
let hovered = null;
let activeTarget = null;
const highlight = () => {
  // ponytail: capture state owns the existing selector; navigation resumes when capture ends.
  controls.dataset.target = activeTarget || hovered || selected;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.action === (activeTarget || selected)));
};
const trackHover = event => window.edge.hover(event.clientX);
document.body.addEventListener('mouseenter', trackHover);
document.body.addEventListener('mousemove', trackHover);
document.body.addEventListener('mouseleave', () => { hovered = null; highlight(); window.edge.hover(null); });
for (const button of buttons) {
  const preview = () => { hovered = button.dataset.action; highlight(); };
  const restore = () => { hovered = null; highlight(); };
  button.addEventListener('pointerenter', preview);
  button.addEventListener('pointerleave', restore);
  button.addEventListener('focus', preview);
  button.addEventListener('blur', restore);
  button.addEventListener('click', () => { selected = button.dataset.action; highlight(); window.edge.action(selected); });
}
window.edge.onState(state => {
  document.body.dataset.theme = state.theme;
  document.body.classList.toggle('collapsed', !state.expanded);
  const capturing = state.recording || state.starting;
  activeTarget = state.agentListening ? 'agent' : capturing ? state.recordingTarget : null;
  document.body.classList.toggle('recording', capturing && state.recordingTarget === 'microphone');
  document.body.classList.toggle('listening', state.agentListening);
  document.body.classList.toggle('busy', state.busy);
  selected = state.selected;
  highlight();
  const microphone = document.querySelector('.microphone');
  const label = state.recording || state.starting ? 'Stop dictation' : 'Start dictation';
  microphone.title = label; microphone.setAttribute('aria-label', label);
  const seconds = Math.floor(state.elapsedSeconds || 0);
  document.querySelector('output').textContent = state.starting ? '•••' : state.recording ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
});
