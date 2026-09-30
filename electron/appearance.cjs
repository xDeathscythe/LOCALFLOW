const fs = require("node:fs");
const path = require("node:path");

const themes = Object.freeze({
  dark: { light: false, glass: true },
  light: { light: true, glass: true },
  "static-black": { light: false, glass: false },
  "static-white": { light: true, glass: false },
});

function validateTheme(theme) {
  if (typeof theme !== "string" || !Object.hasOwn(themes, theme)) throw new Error("Unknown appearance theme");
  return theme;
}

function readAppearance(directory) {
  try { return validateTheme(JSON.parse(fs.readFileSync(path.join(directory, "appearance.json"), "utf8")).theme); }
  catch { return "dark"; }
}

function saveAppearance(directory, theme) {
  validateTheme(theme);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "appearance.json");
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ theme }));
  fs.renameSync(`${file}.tmp`, file);
}

function windowAppearance(theme) {
  const { light, glass } = themes[validateTheme(theme)];
  return {
    hasShadow: false,
    transparent: process.platform === 'win32',
    backgroundColor: glass ? "#00000000" : light ? "#ffffff" : "#000000",
    // The transparent compositor plus native accent blur stays glass when inactive.
    backgroundMaterial: process.platform === 'win32' ? "none" : glass ? "acrylic" : "none",
    titleBarOverlay: { color: "#00000000", symbolColor: light ? "#202622" : "#ffffff", height: 42 },
  };
}

function applyAppearance(window, nativeTheme, theme) {
  const appearance = windowAppearance(theme);
  nativeTheme.themeSource = themes[theme].light ? "light" : "dark";
  window.setBackgroundColor(appearance.backgroundColor);
  window.setTitleBarOverlay(appearance.titleBarOverlay);
  window.setBackgroundMaterial(appearance.backgroundMaterial);
  require('./windows-glass.cjs').applyWindowGlass(window, themes[theme].glass);
}

module.exports = { themes, validateTheme, readAppearance, saveAppearance, windowAppearance, applyAppearance };
