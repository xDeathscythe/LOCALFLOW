const path = require('node:path');
const fs = require('node:fs');

function bundledConnectors(resourcesRoot) {
  const python = path.join(resourcesRoot, 'runtime', 'windows-mcp', 'python.exe');
  if (!fs.existsSync(python)) return {};
  return { 'windows-mcp': { command: python, args: ['-m', 'windows_mcp', 'serve'], enabled: true, protocolVersion: '2026-07-28',
    env: { ANONYMIZED_TELEMETRY: 'false', PYTHONPATH: '', PYTHONHOME: '', PYTHONNOUSERSITE: '1' } } };
}
module.exports = { bundledConnectors };
