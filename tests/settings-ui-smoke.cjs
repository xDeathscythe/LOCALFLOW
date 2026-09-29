const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1260,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "settings-ui-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(path.resolve(__dirname, "../dist/index.html"));
  await window.webContents.executeJavaScript(`
    [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Settings'))?.click();
    new Promise((resolve) => setTimeout(resolve, 250));
  `);
  const outputDir = path.resolve(__dirname, "../runtime/ui-smoke");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "settings.png"), (await window.webContents.capturePage()).toPNG());

  const layout = await window.webContents.executeJavaScript(`(() => {
    const methods = [...document.querySelectorAll('.cleanupAuthMethod')].map((element) => element.getBoundingClientRect());
    const panel = document.querySelector('.utilityPanel')?.getBoundingClientRect();
    const modelLabels = [...document.querySelectorAll('.modelSwitch button strong')].map((element) => element.textContent);
    const holdMode = [...document.querySelectorAll('.modelSwitch button')]
      .find((element) => element.querySelector('strong')?.textContent === 'Hold to speak');
    return {
      methodCount: methods.length,
      equalHeight: methods.length === 2 && Math.abs(methods[0].height - methods[1].height) < 1,
      sameTop: methods.length === 2 && Math.abs(methods[0].top - methods[1].top) < 1,
      panelFitsViewport: Boolean(panel && panel.right <= innerWidth && panel.bottom <= innerHeight),
      hasParakeet: modelLabels.includes('Parakeet TDT 0.6B V3'),
      hasCanary: modelLabels.includes('Canary 1B V2'),
      holdModeIsDefault: holdMode?.classList.contains('active') === true,
    };
  })()`);

  if (!layout.hasParakeet || !layout.hasCanary) throw new Error("STT model options are missing from Settings");
  if (!layout.holdModeIsDefault) throw new Error("Hold to speak must remain the default recording mode");

  await window.webContents.executeJavaScript(`
    [...document.querySelectorAll('.modelSwitch button strong')]
      .find((element) => element.textContent === 'Parakeet TDT 0.6B V3')
      ?.scrollIntoView({ block: 'center' });
    new Promise((resolve) => setTimeout(resolve, 100));
  `);
  fs.writeFileSync(path.join(outputDir, "settings-stt-models.png"), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript(`
    document.querySelector('.cleanupAuthMethod .cleanupAuthButton')?.click();
    new Promise((resolve) => setTimeout(resolve, 100));
  `);
  fs.writeFileSync(path.join(outputDir, "settings-device-code.png"), (await window.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(layout));
  app.quit();
});
