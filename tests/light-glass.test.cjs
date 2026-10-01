const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, nativeTheme } = require('electron');
const { windowAppearance, applyAppearance, themes } = require('../electron/appearance.cjs');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'localflow-light-glass-')));
app.whenReady().then(async () => {
  try {
    const window = new BrowserWindow({ width: 700, height: 500, show: false, titleBarStyle: 'hidden', ...windowAppearance('dark') });
    const css = fs.readFileSync(path.join(__dirname, '../src/styles/themes.css'), 'utf8');
    await window.loadURL('data:text/html,' + encodeURIComponent(`<style>${css}
      html,body{margin:0;background:transparent}.shell{height:100vh;background:var(--niwa-window-bg)}
      aside{position:absolute;width:200px;height:100%;background:var(--sidebar-tint)}
      main{margin-left:200px;height:100%;background:var(--workspace-bg)}
      </style><div class="shell"><aside></aside><main></main></div>`));
    for (const theme of ['light', 'static-white', 'dark', 'static-black', 'light']) {
      applyAppearance(window, nativeTheme, theme);
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}'; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const image = await window.webContents.capturePage(), bytes = image.toBitmap(), { width, height } = image.getSize();
      const alpha = fraction => bytes[(Math.floor(height / 2) * width + Math.floor(width * fraction)) * 4 + 3];
      assert.ok(themes[theme].glass ? alpha(.1) < 100 : alpha(.1) === 255, `${theme}: sidebar alpha ${alpha(.1)}`);
      assert.equal(alpha(.6), 255, `${theme}: workspace stays opaque`);
      if (theme === 'light') {
        const offset = (Math.floor(height / 2) * width + Math.floor(width * .6)) * 4;
        assert.deepEqual([...bytes.subarray(offset, offset + 4)], [255, 255, 255, 255], 'Light workspace stays white');
      }
    }
    window.destroy();
    console.log('LIGHT_GLASS_THEME_SWITCH_OK');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
