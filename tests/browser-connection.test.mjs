import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { createNiwaWeb } from '../host/niwa/host/niwa-web.mjs';

const reserve = tcpServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const site = createServer((_req,res) => res.end('<title>Connection test</title><button id="test">Test</button>'));
await new Promise(resolve => site.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${site.address().port}`;
const owner = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] });
const original = await owner.newPage();
await original.goto(url);
const web = createNiwaWeb(undefined, () => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true }));
try {
  assert.equal(web.status().mode, 'bundled');
  assert.equal((await web.connectChrome()).connected, true);
  const browser = web.tools({id:'test'}).find(t => t.name === 'browser');
  await browser.execute('test', {action:'open',url}, new AbortController().signal);
  assert.equal(original.url(), `${url}/`, 'existing user tab must not be navigated by open');
  const tabs = await browser.execute('test',{action:'tabs'},new AbortController().signal);
  assert(tabs.content[0].text.includes(url));
  await web.disconnectChrome();
  assert(owner.isConnected(), 'disconnect detaches rather than closing Chrome');
  assert.equal(await original.title(),'Connection test');
  assert.equal(web.status().mode,'bundled');
  console.log('CHROME_ATTACH_EXISTING_TABS_DETACH_PRESERVES_BROWSER_OK');
} finally { await web.close(); await owner.close(); await new Promise(resolve=>site.close(resolve)); }
