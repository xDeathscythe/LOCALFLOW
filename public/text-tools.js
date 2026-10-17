const { core } = window.__TAURI__;
const value = window.TEXT_TOOLS;
document.documentElement.dataset.theme=value.theme;
const root = document.getElementById('root');
const labels = { capture:'text-capture', toast:'text-toast' };
const call = (method, value) => core.invoke('native_call', { method, args:[value] });
const close = () => call('text-tools-close', labels[value.mode]);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); void close(); } });
if (value.mode === 'toast') {
  root.innerHTML = '<div class="toast" role="status"><span class="check" aria-label="Copied to clipboard">✓</span></div>';
  setTimeout(() => void close(), 1500);
}
if (value.mode === 'capture') void window.startScreenText({ root, value, call, close });
