(() => {
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const call = (method, value) => invoke('native_call', { method, args:[value] });
let hovered = false;
window.edge = {
  hover: value => { const next = value !== null; if (next === hovered) return; hovered = next; void call('edge-hover', value); },
  action: value => { void call('edge-action', value); },
  onState: callback => { void listen('edge-state', event => callback(event.payload)).then(() => call('edge-ready', null)); },
};
})();
