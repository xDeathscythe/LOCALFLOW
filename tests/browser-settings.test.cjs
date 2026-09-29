const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
app.setPath('userData',fs.mkdtempSync(path.resolve('runtime/browser-settings-')));
app.whenReady().then(async () => {
  try {
    const window = new BrowserWindow({show:false,width:1200,height:900,webPreferences:{offscreen:true,backgroundThrottling:false,preload:path.resolve('tests/settings-ui-preload.cjs')}});
    await window.loadFile(path.resolve('dist/index.html'));
    await window.webContents.executeJavaScript(`document.querySelector('[data-section="settings"]').click()`);
    await new Promise(resolve=>setTimeout(resolve,200));
    const click = text => window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.niwaBrowserConnection button')).find(el=>el.textContent.includes(${JSON.stringify(text)}) && el.getClientRects().length).click()`);
    await click('Connect browser');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.niwaBrowserConnection strong')).some(el=>el.textContent==='Chrome connected' && el.getClientRects().length)`));
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.niwaBrowserConnection')).find(el=>el.getClientRects().length).scrollIntoView({block:'center'})`);
    await new Promise(resolve=>setTimeout(resolve,300));
    fs.writeFileSync(path.resolve('runtime/browser-settings.png'),(await window.webContents.capturePage()).toPNG());
    await click('Disconnect');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.niwaBrowserConnection strong')).some(el=>el.textContent==='Browser connection' && el.getClientRects().length)`));
    console.log('SETTINGS_CONNECT_DISCONNECT_BROWSER_UI_OK');
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
