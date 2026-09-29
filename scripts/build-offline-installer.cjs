const assert = require('node:assert/strict');
const path = require('node:path');
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
build({
  targets: Platform.WINDOWS.createTarget(['nsis-web'], Arch.x64),
  prepackaged: path.resolve(process.argv[2] || 'release/win-unpacked'),
  config: { directories: { output: process.argv[3] || 'release' } },
  publish: 'never',
  platformPackagerFactory: info => new OfflinePackager(info),
}).catch(error => { console.error(error); process.exitCode = 1; });
