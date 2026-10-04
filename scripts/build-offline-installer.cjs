const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdirSync, rmSync, readdirSync, openSync, fsyncSync, closeSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const { build, Platform, Arch } = require('electron-builder');
const { WinPackager } = require('app-builder-lib/out/winPackager');
const { WebInstallerTarget } = require('app-builder-lib/out/targets/nsis/WebInstallerTarget');
const { AppPackageHelper, CopyElevateHelper } = require('app-builder-lib/out/targets/nsis/nsisUtil');

// Keep electron-builder's installer/update handling, but leave the offline
// distribution archive on the user's media instead of moving gigabytes to C:.
class OfflineTarget extends WebInstallerTarget {
  async computeFinalScript(script, ...args) {
    const anchor = '!include "installUtil.nsh"';
    assert.equal(script.split(anchor).length, 2, 'Review the updated NSIS template before shipping');
    return super.computeFinalScript(script.replace(anchor,
      `${anchor}\n  !include "\${BUILD_RESOURCES_DIR}\\offline-archive.nsh"`), ...args);
  }
}

class OfflinePackager extends WinPackager {
  createTargets(targets, mapper) {
    assert.deepEqual(targets, ['nsis-web']);
    mapper('nsis-web', outDir => new OfflineTarget(this, path.join(outDir, 'nsis-web'),
      'nsis-web', new AppPackageHelper(new CopyElevateHelper())));
  }
}

process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '1';
const temp = path.resolve('runtime/build-temp');
mkdirSync(temp, { recursive: true });
process.env.TEMP = process.env.TMP = temp;
const outputDirectory = path.resolve(process.argv[3] || 'release');
const archive = path.join(outputDirectory, 'nsis-web', `localflow-${require('../package.json').version}-x64.nsis.7z`);
// electron-builder otherwise reuses even an incomplete archive from a cancelled build.
rmSync(archive, { force: true });
build({
  targets: Platform.WINDOWS.createTarget(['nsis-web'], Arch.x64),
  prepackaged: path.resolve(process.argv[2] || 'release/win-unpacked'),
  config: { directories: { output: outputDirectory } },
  publish: 'never',
  platformPackagerFactory: info => new OfflinePackager(info),
}).then(async () => {
  const folder = path.dirname(archive);
  for (const file of readdirSync(folder).filter(name => /\.(exe|7z|yml)$/.test(name))) {
    const descriptor = openSync(path.join(folder, file), 'r+');
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
  execFileSync(await getPath7za(), ['t', archive, '-bsp0'], { stdio: 'inherit', windowsHide: true });
}).catch(error => { console.error(error); process.exitCode = 1; });
