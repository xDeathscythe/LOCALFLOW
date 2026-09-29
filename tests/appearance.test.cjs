const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
const { themes, readAppearance, saveAppearance, windowAppearance, applyAppearance } = require("../electron/appearance.cjs");

const output = path.resolve(__dirname, "../runtime/appearance-check");
fs.mkdirSync(output, { recursive: true });
const directory = fs.mkdtempSync(path.join(output, "profile-"));
app.setPath("userData", directory);

app.whenReady().then(async () => {
  let window;
  try {
    assert.equal(readAppearance(directory), "dark");
    assert.throws(() => saveAppearance(directory, "__proto__"));
    assert.throws(() => saveAppearance(directory, null));
    fs.writeFileSync(path.join(directory, "appearance.json"), "corrupt");
    assert.equal(readAppearance(directory), "dark");
    window = new BrowserWindow({ width: 1240, height: 860, show: false, titleBarStyle: "hidden",
      ...windowAppearance("dark"),
      webPreferences: { preload: path.join(__dirname, "settings-ui-preload.cjs"), additionalArguments: ["--appearance-check"], contextIsolation: true, nodeIntegration: false } });
    let current = "dark";
    ipcMain.handle("get-appearance", () => readAppearance(directory));
    ipcMain.handle("set-appearance", (_event, theme) => {
      saveAppearance(directory, theme); applyAppearance(window, nativeTheme, theme); current = theme; return theme;
    });
    const errors = [];
    window.webContents.on("console-message", details => { if (details.level === "error") errors.push(details.message); });
    const js = code => window.webContents.executeJavaScript(code).catch(error => { console.error('Failed UI check:', code); throw error; });
    const waitFor = async code => {
      for (let i = 0; i < 100; i++) {
        if (await js(code)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`Timed out: ${code}`);
    };
    const navigate = async section => {
      await js(`document.querySelector('[data-section="${section}"]').click()`);
      await waitFor(`document.querySelector('[data-section="${section}"]').getAttribute('aria-current') === 'page'`);
    };
    const screenshot = async name => {
      await js(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
      await new Promise(resolve => setTimeout(resolve, 300));
      fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    };
    await window.loadFile(path.resolve(__dirname, "../dist/index.html"));
    await window.webContents.insertCSS("*, *::before, *::after { transition: none !important; }");
    await waitFor(`!!document.querySelector('.navItem')`);
    assert.equal(await js(`document.querySelector('.brandLogo').getAttribute('src')`), "./localflow-logo.png");
    assert.equal(await js(`document.querySelectorAll('[data-theme-option]').length`), 0, "Picker belongs only in Settings");
    await js(`document.querySelector('[data-action="import"]').click()`);
    await waitFor(`document.querySelectorAll('.recentCard').length === 1`);
    await js(`document.querySelector('[data-action="save-note"]').click()`);
    await waitFor(`!!document.querySelector('.notesTreePane')`);
    assert.equal(await js(`document.querySelector('.notesTreePane').getBoundingClientRect().width`), 296);
    assert.ok(await js(`document.querySelector('.noteDocument').value.includes('Keep the interface quiet')`));
    await navigate("transcribe");
    await js(`document.querySelector('[data-action="new-session"]').click()`);
    await waitFor(`document.querySelector('.textPane textarea').value === ''`);
    await js(`document.querySelector('.recentCard').click()`);
    await waitFor(`document.querySelector('.textPane textarea').value.length > 20`);
    await navigate("settings");
    assert.equal(await js(`document.querySelectorAll('[data-theme-option]').length`), 4);
    const results = [];
    for (const theme of Object.keys(themes)) {
      await js(`document.querySelector('[data-theme-option="${theme}"]').click()`);
      await waitFor(`document.documentElement.dataset.theme === '${theme}' && !document.querySelector('[data-theme-option]').disabled`);
      assert.equal(current, theme);
      assert.equal(readAppearance(directory), theme);
      assert.equal(nativeTheme.themeSource, themes[theme].light ? "light" : "dark");
      assert.equal(windowAppearance(theme).backgroundMaterial, themes[theme].glass ? "acrylic" : "none");
      assert.equal(windowAppearance(theme).backgroundColor, themes[theme].glass ? "#00000000" : themes[theme].light ? "#ffffff" : "#000000");
      await screenshot(`${theme}-settings`);
      await navigate("transcribe");
      const style = await js(`(() => {
        const shell = getComputedStyle(document.querySelector('.appShell'));
        const panes = [...document.querySelectorAll('.textPane')];
        return { theme: document.documentElement.dataset.theme, background: shell.backgroundColor,
          shellRadius: shell.borderRadius, blur: shell.backdropFilter,
          artwork: !!document.querySelector('.desktopBackdrop'),
          radius: getComputedStyle(panes[0]).borderRadius,
          fits: panes.every(p => p.getBoundingClientRect().right <= innerWidth),
          recordVisible: document.querySelector('.recordButton').getBoundingClientRect().bottom <= innerHeight,
          logoLoaded: document.querySelector('.brandLogo').naturalWidth > 0 };
      })()`);
      assert.equal(style.radius, "21px"); assert.ok(style.fits && style.recordVisible && style.logoLoaded);
      assert.equal(style.shellRadius, "0px"); assert.equal(style.blur, "none"); assert.equal(style.artwork, false);
      if (!themes[theme].glass) assert.equal(style.background, themes[theme].light ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
      else assert.ok(style.background.startsWith("rgba("));
      results.push(style);
      await screenshot(`${theme}-transcribe`);
      const surface = await window.webContents.capturePage({ x: 215, y: 80, width: 1, height: 1 });
      const alpha = surface.toBitmap()[3];
      assert.ok(themes[theme].glass ? alpha < 100 : alpha === 255, `${theme} surface alpha: ${alpha}`);
      await navigate("settings");
    }
    // Compare geometry directly with the approved HTML, not just theme token values.
    const reference = new BrowserWindow({ width: 1320, height: 1020, show: false });
    await reference.loadFile(path.resolve(__dirname, "../prototypes/niwa-localflow/index.html"));
    reference.setContentSize(1320, 1000);
    await reference.webContents.executeJavaScript("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
    const expected = await reference.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.app').getBoundingClientRect();
      const card = document.querySelector('.transcript-card').getBoundingClientRect();
      return { width: shell.width, cardHeight: card.height, cardTop: card.top - shell.top, dockHeight: document.querySelector('.recording-dock').getBoundingClientRect().height };
    })()`);
    await navigate("transcribe");
    const actual = await js(`(() => {
      const shell = document.querySelector('.appShell').getBoundingClientRect();
      const card = document.querySelector('.textPane').getBoundingClientRect();
      return { width: shell.width, cardHeight: card.height, cardTop: card.top - shell.top, dockHeight: document.querySelector('.recordingDock').getBoundingClientRect().height };
    })()`);
    reference.destroy();
    for (const key of Object.keys(expected)) assert.ok(Math.abs(expected[key] - actual[key]) < 3, key + ': ' + JSON.stringify({ expected, actual }));
    await window.webContents.reload();
    await waitFor(`document.documentElement.dataset.theme === 'static-white' && !!document.querySelector('.navItem')`);
    for (const section of ["notes", "niwa", "history", "files", "shortcuts"]) {
      await navigate(section); await screenshot(`static-white-${section}`);
    }
    window.setSize(1060, 720);
    await navigate("transcribe");
    await screenshot("transcribe-minimum-size");
    assert.ok(await js(`document.querySelector('.recordButton').getBoundingClientRect().bottom <= innerHeight`));
    await navigate("settings");
    await screenshot("settings-minimum-size");
    assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ themes: results, referenceGeometry: { expected, actual }, notesPickerPreserved: true, importSaveReopen: true, persistence: true, settingsOnly: true, errors }));
  } finally { window?.destroy(); }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
