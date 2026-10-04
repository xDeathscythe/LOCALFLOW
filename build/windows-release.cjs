const { build } = require('../package.json');
const { existsSync, readdirSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

// One install includes dictation and the agent's tools. Personal voice clones
// and optional multi-gigabyte engines stay out of the public download.
module.exports = {
  ...build,
  files: build.files.filter(file => file !== 'dist/**/*').concat({ from: 'runtime/release-ui', to: 'dist', filter: ['**/*'] }),
  beforePack: async () => {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/stage-vc-runtime.ps1', '-VerifyOnly'], { stdio: 'inherit', windowsHide: true });
    // Keep NSIS's multi-gigabyte temporary files beside the build, off the OS disk.
    const temp = resolve('runtime/build-temp');
    mkdirSync(temp, { recursive: true });
    process.env.TEMP = process.env.TMP = temp;
    for (const file of [
      'runtime/release-ui/index.html',
      'scripts/setup-windows.py', 'backend/window_glass.py',
      'runtime/python/python.exe', 'runtime/python-packages/faster_whisper/__init__.py',
      'runtime/cuda/bin/cublas64_12.dll', 'runtime/cuda/bin/cublasLt64_12.dll', 'runtime/cuda/bin/cudnn64_9.dll',
      'runtime/distribution/windows-mcp/python.exe',
      'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
      ...['large-v3'].flatMap(model =>
        ['config.json', 'model.bin', 'tokenizer.json', 'preprocessor_config.json', 'vocabulary.json'].map(file => `models/whisper/${model}/${file}`)),
    ]) if (!existsSync(resolve(file))) throw new Error(`Installer payload missing: ${file}`);
    if (!readdirSync('runtime/browsers').some(name => name.startsWith('chromium_headless_shell-') && existsSync(resolve('runtime/browsers', name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'))))
      throw new Error('Bundled Chromium headless shell is missing. Run npx playwright install chromium.');
  },
  afterPack: async ({ appOutDir }) => {
    for (const file of [
      'models/whisper/large-v3/model.bin', 'backend/whisper_runtime.py', 'backend/model_downloads.py',
      'runtime/prerequisites/vc_redist.x64.exe', 'runtime/prerequisites/vc-runtime.json',
      'backend/hotkey_watcher.py', 'backend/paste_input.py',
      'runtime/cuda/bin/cublas64_12.dll', 'runtime/cuda/bin/cublasLt64_12.dll', 'runtime/cuda/bin/cudnn64_9.dll',
    ]) if (!existsSync(resolve(appOutDir, 'resources', file))) throw new Error(`Packaged payload missing: ${file}`);
  },
  directories: { output: 'release/windows' },
  extraResources: build.extraResources
    .filter(item => item.from !== 'runtime/distribution')
    .map(item => item.from === 'assets/tts' ? { ...item, filter: ['README.md'] }
      : item.from === 'scripts' ? { ...item, filter: ['install-tts.ps1', 'prepare-tts-models.py', 'setup-windows.py'] }
      : item.from === 'runtime/browsers' ? { ...item, filter: ['chromium_headless_shell-*/**/*', 'ffmpeg-*/**/*', 'winldd-*/**/*'] }
      : ['runtime/python', 'runtime/python-packages'].includes(item.from)
        ? { ...item, filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc'] } : item)
    .concat([
      { from: 'runtime/distribution/windows-mcp', to: 'runtime/windows-mcp', filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc'] },
    ]),
  // No in-app updater uses differential archives; normal compression reduces
  // the size of the bundled offline models.
  nsis: { ...build.nsis, differentialPackage: false, runAfterFinish: true,
    artifactName: 'LocalFlow-Setup-${version}.${ext}' },
};
