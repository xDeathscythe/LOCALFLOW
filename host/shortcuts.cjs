const fs = require("fs");
const path = require("path");

const SHORTCUT_ACTIONS = new Set(["dictation", "import-audio", "reset-session", "niwa-agent"]);
const FORBIDDEN_SHORTCUT_KEYS = new Set([0x01, 0x02, 0x04]);
const DEFAULT_SHORTCUTS = Object.freeze({
  "niwa-agent": { keys: [0x11, 0x14], label: "Ctrl + Caps Lock" },
  dictation: { keys: [0x11, 0x10], label: "Ctrl + Shift" },
  "import-audio": { keys: [0x11, 0x4f], label: "Ctrl + O" },
  "reset-session": { keys: [0x11, 0x52], label: "Ctrl + R" },
});
function normalizeShortcutBinding(binding) {
  const keys = Array.isArray(binding?.keys)
    ? [...new Set(binding.keys.filter((key) => Number.isInteger(key) && key > 0 && key <= 0xff))]
    : [];
  const label = typeof binding?.label === "string" ? binding.label.trim().slice(0, 80) : "";
  if (keys.length === 0 || keys.length > 4 || keys.some((key) => FORBIDDEN_SHORTCUT_KEYS.has(key)) || !label) {
    throw new Error("Invalid shortcut. Left, right, middle mouse buttons and wheel input are not supported.");
  }
  return { keys, label };
}

function defaultShortcuts() {
  return Object.fromEntries(Object.entries(DEFAULT_SHORTCUTS).map(([action, binding]) => [
    action,
    { keys: [...binding.keys], label: binding.label },
  ]));
}

function configPath(userDataPath) {
  return path.join(userDataPath, "shortcuts.json");
}

function isAllowedAction(action) { return SHORTCUT_ACTIONS.has(action); }

function readShortcuts(userDataPath) {
  const defaults = defaultShortcuts();
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(userDataPath), "utf8"));
    for (const action of SHORTCUT_ACTIONS) {
      if (parsed?.[action]) defaults[action] = normalizeShortcutBinding(parsed[action]);
    }
  } catch {
    // Missing or invalid local settings use the working defaults.
  }
  return defaults;
}

function ensureShortcuts(userDataPath) {
  const config = readShortcuts(userDataPath);
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(configPath(userDataPath), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

function saveShortcut(userDataPath, action, binding) {
  if (!isAllowedAction(action)) throw new Error("Unknown shortcut action.");
  const normalized = normalizeShortcutBinding(binding);
  const config = readShortcuts(userDataPath);
  const signature = [...normalized.keys].sort((left, right) => left - right).join("+");
  const conflict = Object.entries(config).find(([otherAction, otherBinding]) => (
    otherAction !== action
    && [...otherBinding.keys].sort((left, right) => left - right).join("+") === signature
  ));
  if (conflict) throw new Error(`That shortcut is already assigned to ${conflict[1].label}.`);
  config[action] = normalized;
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(configPath(userDataPath), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

module.exports = { ensureShortcuts, normalizeShortcutBinding, readShortcuts, saveShortcut };
