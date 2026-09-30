const { BrowserWindow, ipcMain, screen } = require('electron');
const { join } = require('node:path');
const { readFileSync, writeFileSync, renameSync } = require('node:fs');

function readEdgeSettings(directory) {
  try {
    const value = JSON.parse(readFileSync(join(directory, 'edge-panel.json'), 'utf8'));
    return { enabled: value.enabled !== false, autoHide: value.autoHide !== false };
  } catch { return { enabled: true, autoHide: true }; }
}

function createEdgePanel({ directory, display, onAction, onChange }) {
  let settings = readEdgeSettings(directory);
  let state = { recording: false, starting: false, agentListening: false, recordingTarget: 'microphone', busy: false, voice: false, elapsedSeconds: 0, theme: 'dark', selected: 'microphone' };
  let hover = false;
  let hoverTimer;
  let window;
  let expanded;
  const bounds = () => {
    const area = display().workArea;
    const width = area.width <= 1600 ? 31 : 37;
    return { x: area.x + area.width - width, y: area.y + 79, width, height: 146 };
  };
  const sync = () => {
    if (!window || window.isDestroyed()) return;
    const next = !settings.autoHide || hover || state.recording || state.starting || state.agentListening || state.busy;
    if (next !== expanded) {
      expanded = next;
      // Keep the transparent canvas stable; forward movement to the collapsed edge handle.
      window.setIgnoreMouseEvents(!expanded, { forward: true });
    }
    const target = bounds(), current = window.getBounds();
    if (Object.keys(target).some(key => target[key] !== current[key])) window.setBounds(target);
    if (settings.enabled !== window.isVisible()) {
      if (settings.enabled) window.showInactive(); else window.hide();
    }
    window.webContents.send('edge-state', { ...state, ...settings, expanded });
  };
  window = new BrowserWindow({
    ...bounds(), show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false,
    webPreferences: { preload: join(__dirname, 'edge-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.loadFile(join(__dirname, 'edge-panel.html'));
  window.webContents.on('did-finish-load', sync);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const receiveHover = (event, x) => {
    if (event.sender !== window.webContents) return;
    // Decide against native state: forwarded movement can arrive before the CSS collapse.
    const width = window.getBounds().width;
    const next = typeof x === 'number' && x >= 0 && x < width && (expanded || x >= width - 5);
    if (hover === next) return;
    hover = next;
    clearInterval(hoverTimer);
    // Native transparent windows can lose mouseleave. Check only while hovered.
    if (hover) hoverTimer = setInterval(() => {
      const cursor = screen.getCursorScreenPoint(), area = window.getBounds();
      if (cursor.x >= area.x && cursor.x < area.x + area.width && cursor.y >= area.y && cursor.y < area.y + area.height) return;
      hover = false; clearInterval(hoverTimer); sync();
    }, 200);
    sync();
  };
  const receiveAction = (event, action) => {
    if (event.sender !== window.webContents || !['agent', 'microphone', 'notes'].includes(action)) return;
    state.selected = action; sync(); onAction(action);
  };
  ipcMain.on('edge-hover', receiveHover);
  ipcMain.on('edge-action', receiveAction);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, sync);
  return {
    get: () => ({ ...settings }),
    set: value => {
      if (typeof value?.enabled !== 'boolean' || typeof value?.autoHide !== 'boolean') throw new Error('Invalid edge settings.');
      const file = join(directory, 'edge-panel.json');
      settings = { enabled: value.enabled, autoHide: value.autoHide };
      writeFileSync(file + '.tmp', JSON.stringify(settings)); renameSync(file + '.tmp', file);
      hover = false; clearInterval(hoverTimer); sync(); onChange(); return { ...settings };
    },
    update: value => { state = { ...state, ...value }; sync(); },
    close: () => {
      clearInterval(hoverTimer);
      ipcMain.removeListener('edge-hover', receiveHover); ipcMain.removeListener('edge-action', receiveAction);
      for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(event, sync);
      window.destroy();
    },
  };
}
module.exports = { createEdgePanel, readEdgeSettings };
