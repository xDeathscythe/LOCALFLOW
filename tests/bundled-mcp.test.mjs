import assert from 'node:assert/strict';
import { createNiwaConnectors } from '../electron/niwa/host/niwa-connectors.mjs';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = mkdtempSync(resolve('runtime/connector-check-'));
const direct = createNiwaConnectors(directory, { 'windows-mcp': { command: resolve('runtime/distribution/windows-mcp/python.exe'), args: ['-m','windows_mcp','serve'], enabled: true, protocolVersion:'2026-07-28', env: { PYTHONPATH:'',PYTHONHOME:'',PYTHONNOUSERSITE:'1',ANONYMIZED_TELEMETRY:'false' } } });
try {
  const tool = direct.tools().find(t => t.name === 'connector_tools');
  const result = await tool.execute('test', {connector:'windows-mcp'}, new AbortController().signal);
  const text = result.content.filter(c=>c.type==='text').map(c=>c.text).join('');
  assert(text.includes('Snapshot') && text.includes('Click'));
  const inventory = await direct.tools().find(t => t.name === 'connector_call').execute('inventory', { connector: 'windows-mcp', name: 'DisplayInventory', arguments: {} }, new AbortController().signal);
  assert(inventory.content.length > 0);
  console.log('BUNDLED_WINDOWS_MCP_DISCOVERY_OK', text.slice(0,140));
} finally { await direct.close(); }
