const { build } = require('../package.json');
const { existsSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

// One install includes dictation and the agent's tools. Personal voice clones
// and optional multi-gigabyte engines stay out of the public download.
module.exports = {
  ...build,
  beforePack: async () => {
    for (const file of [
      'runtime/python/python.exe', 'runtime/python-packages/faster_whisper/__init__.py',
      'runtime/distribution/windows-mcp/python.exe',
      'runtime/distribution/tts/piper/.venv/Scripts/python.exe',
      'runtime/distribution/tts/piper/voices/en_US-kristin-medium.onnx',
      'runtime/distribution/tts/piper/voices/en_US-kristin-medium.onnx.json',
      'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
      ...['config.json', 'model.bin', 'tokenizer.json', 'preprocessor_config.json', 'vocabulary.json'].map(file => `models/whisper/large-v3-turbo/${file}`),
    ]) if (!existsSync(resolve(file))) throw new Error(`Installer payload missing: ${file}`);
    if (!readdirSync('runtime/browsers').some(name => name.startsWith('chromium_headless_shell-') && existsSync(resolve('runtime/browsers', name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'))))
      throw new Error('Bundled Chromium headless shell is missing. Run npx playwright install chromium.');
  },
  directories: { output: 'release/windows' },
  extraResources: build.extraResources
    .filter(item => !['runtime/cuda', 'runtime/distribution'].includes(item.from))
    .map(item => item.from === 'models/whisper'
      ? { ...item, filter: ['large-v3-turbo/**/*'] }
      : item.from === 'assets/tts' ? { ...item, filter: ['README.md'] }
      : item.from === 'scripts' ? { ...item, filter: ['install-tts.ps1', 'prepare-tts-models.py'] }
      : item.from === 'runtime/browsers' ? { ...item, filter: ['chromium_headless_shell-*/**/*', 'ffmpeg-*/**/*', 'winldd-*/**/*'] }
      : ['runtime/python', 'runtime/python-packages'].includes(item.from)
        ? { ...item, filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc'] } : item)
    .concat([
      { from: 'runtime/distribution/windows-mcp', to: 'runtime/windows-mcp', filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc'] },
      { from: 'runtime/distribution/tts/piper', to: 'runtime/tts/piper', filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc'] },
    ]),
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, runAfterFinish: true,
    artifactName: 'LocalFlow-Setup-${version}.${ext}' },
};
