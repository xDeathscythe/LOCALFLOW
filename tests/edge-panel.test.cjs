const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
const { createEdgePanel, readEdgeSettings } = require('../electron/edge-panel.cjs');
const output = path.resolve('runtime/edge-panel-check');
fs.mkdirSync(output, { recursive: true });
const directory = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', directory);
const pause = (ms = 720) => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let edge;
  try {
    const actions = [];
    // Keep the test window away from the owner's live panel and pointer.
    const area = { ...screen.getPrimaryDisplay().workArea };
    area.width = Math.floor(area.width / 2);
    assert.deepEqual(readEdgeSettings(directory), { enabled: true, autoHide: true });
    edge = createEdgePanel({ directory, display: () => ({ workArea: area }), onAction: action => actions.push(action), onChange: () => {} });
    const window = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    await pause();
    assert.equal(window.getBounds().width, 37);
    const nativeCalls = { resize: 0, show: 0, ignore: [] };
    const setBounds = window.setBounds.bind(window), showInactive = window.showInactive.bind(window), setIgnoreMouseEvents = window.setIgnoreMouseEvents.bind(window);
    window.setBounds = (...args) => { nativeCalls.resize++; return setBounds(...args); };
    window.showInactive = (...args) => { nativeCalls.show++; return showInactive(...args); };
    window.setIgnoreMouseEvents = (ignore, options) => { nativeCalls.ignore.push({ ignore, options }); return setIgnoreMouseEvents(ignore, options); };
    const shape = () => window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".silhouette path")).d');
    const closedShape = await shape();
    await window.webContents.executeJavaScript(`document.body.dispatchEvent(new MouseEvent('mousemove', {clientX: 12}))`); await pause(80);
    assert.equal(await shape(), closedShape, 'transparent area does not reveal the collapsed panel');
    await window.webContents.executeJavaScript(`document.body.dispatchEvent(new MouseEvent('mousemove', {clientX: 35}))`); await pause(80);
    assert.deepEqual(nativeCalls.ignore.at(-1), { ignore: false, options: { forward: true } }, 'edge handle restores native clicks');
    const openingShape = await shape();
    fs.writeFileSync(path.join(output, 'opening.png'), (await window.webContents.capturePage()).toPNG());
    await pause();
    const openShape = await shape();
    assert.notEqual(openingShape, closedShape, 'shape starts morphing');
    assert.notEqual(openingShape, openShape, 'opening has intermediate geometry');
    assert.deepEqual(window.getBounds(), { x: area.x + area.width - 37, y: area.y + Math.max(0, Math.round(area.height * .28 - 62) - 155), width: 37, height: 146 });
    const centered = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).map(button => { const b = button.getBoundingClientRect(); return {left:b.left,right:innerWidth-b.right}; })`);
    assert(centered.every(button => Math.abs(button.left - button.right) < .1), 'all three controls have equal horizontal margins');
    const contour = await window.webContents.executeJavaScript(`(() => {
      const path = document.querySelector('.silhouette path');
      const inside = (x, y) => path.isPointInFill(new DOMPoint(x, y));
      let symmetric = true, clearance = true;
      for (let x = .5; x < 37; x++) for (let y = .5; y < 73; y++)
        if (inside(x, y) !== inside(x, 146 - y)) symmetric = false;
      for (const button of document.querySelectorAll('button')) {
        const b = button.getBoundingClientRect(), r = b.width / 2;
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 24) {
          const x = b.left + r + r * Math.cos(angle);
          const y = (Math.sin(angle) < 0 ? b.top + r : b.bottom - r) + r * Math.sin(angle);
          for (const [dx, dy] of [[-2,0],[2,0],[0,-2],[0,2]]) if (!inside(x + dx, y + dy)) clearance = false;
        }
      }
      const b = document.querySelector('.controls').getBoundingClientRect();
      return { symmetric, clearance, top: b.top, bottom: innerHeight - b.bottom };
    })()`);
    assert(contour.symmetric, 'opposing curves are mirrored');
    assert(contour.clearance, 'every selector position clears the contour by at least 2px');
    assert.equal(contour.top, 28); assert.equal(contour.bottom, 28);
    const selectorY = () => window.webContents.executeJavaScript('new DOMMatrix(getComputedStyle(document.querySelector(".selector")).transform).m42');
    assert.equal(await selectorY(), 31, 'selector starts on microphone');
    await window.webContents.executeJavaScript(`document.querySelector('[data-action=agent]').dispatchEvent(new PointerEvent('pointerenter'))`); await pause(80);
    assert((await selectorY()) > 0 && (await selectorY()) < 31, 'hover selector travels through intermediate positions');
    await pause(); assert.equal(await selectorY(), 0);
    await window.webContents.executeJavaScript(`document.querySelector('[data-action=agent]').dispatchEvent(new PointerEvent('pointerleave'))`); await pause();
    assert.equal(await selectorY(), 31, 'hover exit restores selected microphone');
    for (const theme of ['dark', 'light', 'static-black', 'static-white']) {
      edge.update({ theme, recording: true, elapsedSeconds: 83 }); await pause();
      fs.writeFileSync(path.join(output, `${theme}.png`), (await window.webContents.capturePage()).toPNG());
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("output").textContent'), '1:23');
    }
    edge.update({ theme: 'dark', recording: false });
    for (const action of ['agent', 'microphone', 'notes']) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-action="${action}"]').click()`);
      await pause();
      fs.writeFileSync(path.join(output, `selected-${action}.png`), (await window.webContents.capturePage()).toPNG());
    }
    await pause(); assert.deepEqual(actions, ['agent', 'microphone', 'notes']);
    assert.equal(await selectorY(), 62, 'clicking Notes moves the one shared selector');
    await window.webContents.executeJavaScript(`document.querySelector('[data-action=agent]').dispatchEvent(new PointerEvent('pointerenter'))`); await pause();
    assert.equal(await selectorY(), 0);
    await window.webContents.executeJavaScript(`document.querySelector('[data-action=agent]').dispatchEvent(new PointerEvent('pointerleave'))`); await pause();
    assert.equal(await selectorY(), 62, 'hover exit restores selected Notes');
    edge.update({ selected: 'agent' }); await pause(); assert.equal(await selectorY(), 0, 'main-window selection synchronizes the panel');
    edge.update({ recording: true, elapsedSeconds: 12 }); await pause();
    assert.equal(await selectorY(), 0, 'recording timer updates do not override selection');
    assert.match(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".levels i")).animationName'), /recording-wave/);
    assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".mic")).animationName'), 'none', 'microphone no longer stretches');
    edge.update({ voice: true }); await pause(80);
    assert.match(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector("[data-action=agent] svg")).animationName'), /star-orbit/);
    await window.webContents.executeJavaScript('window.edge.hover(null)'); await pause();
    assert.equal(window.getBounds().width, 37, 'recording keeps panel open');
    edge.update({ recording: false, voice: false });
    await window.webContents.executeJavaScript('window.edge.hover(12)');
    await pause(80);
    const closingShape = await shape();
    assert.notEqual(closingShape, openShape, 'closing morph begins');
    assert.notEqual(closingShape, closedShape, 'closing has intermediate geometry');
    assert.equal(window.getBounds().width, 37, 'closing keeps the native canvas stable');
    await window.webContents.executeJavaScript('window.edge.hover(35)'); await pause();
    assert.equal(window.getBounds().width, 37, 'reversing close keeps the native canvas stable');
    await window.webContents.executeJavaScript(`document.body.dispatchEvent(new MouseEvent('mouseleave'))`); await pause();
    assert.equal(window.getBounds().width, 37);
    assert.equal(await shape(), closedShape);
    assert.deepEqual(nativeCalls.ignore.at(-1), { ignore: true, options: { forward: true } }, 'collapsed canvas passes clicks through while forwarding movement');
    for (let i = 0; i < 5; i++) edge.update({ recording: false });
    await pause();
    assert.equal(nativeCalls.resize, 0, 'morph and visibility updates never resize the transparent window');
    assert.equal(nativeCalls.show, 0, 'minimize/restore state updates never re-show an already visible panel');
    edge.set({ enabled: true, autoHide: false }); await pause(); assert.equal(window.getBounds().width, 37);
    edge.set({ enabled: false, autoHide: false }); assert.equal(window.isVisible(), false);
    assert.deepEqual(readEdgeSettings(directory), { enabled: false, autoHide: false });
    console.log('EDGE_CURVES_POSITION_SELECTOR_HOVER_SELECTION_MORPH_THEMES_OK');
    edge.close(); app.exit(0);
  } catch (error) { console.error(error); edge?.close(); app.exit(1); }
});
