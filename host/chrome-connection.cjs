const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

async function connectChrome(agent) {
  // Do not open setup for a busy agent or bypass a denied Chrome permission.
  const state = agent.snapshot();
  if (state.busy || state.voice) throw new Error('End voice and the current task before connecting Chrome.');
  try { return await agent.connectBrowser(); }
  catch (error) {
    const chrome = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(existsSync);
    if (!chrome) throw new Error('Install Google Chrome to connect your browser. The bundled browser is already available.');
    await new Promise((resolve, reject) => {
      const child = spawn(chrome, ['chrome://inspect/#remote-debugging'], { windowsHide: true, detached: true, stdio: 'ignore' });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    });
    throw new Error('Allow remote debugging in the opened Chrome page, then click Connect browser again and approve Chrome’s connection request.');
  }
}
module.exports = { connectChrome };
