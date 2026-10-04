const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
async function main() {
const root = fs.mkdtempSync(path.resolve('runtime/timeline-ui-'));
app.setPath('userData', path.join(root, 'profile'));
require('node:module').createRequire(require.resolve('vite/package.json'))('esbuild').buildSync({ bundle: true, jsx: 'automatic', outfile: path.join(root, 'view.js'), stdin: { resolveDir: path.resolve('.'), loader: 'tsx', contents: `
import {useState} from 'react';import{createRoot}from'react-dom/client';
import{TimelineView}from'./src/components/notes/TimelineView';import'./src/styles/notes.css';
const rows=Array.from({length:5000},(_,i)=>({id:String(i),pageId:String(i),values:{title:'Row '+i,date:{start:'2026-10-15'}}}));
function View(){const[month,setMonth]=useState(new Date(2026,9,1));return <TimelineView rows={rows} title={{id:'title',name:'Name',type:'title'}} dateProperty={{id:'date',name:'Date',type:'date'}} month={month} onMonthChange={setMonth} earliestDate="2026-09-01" open={id=>document.body.dataset.opened=id}/>}
createRoot(document.getElementById('root')!).render(<View/>);` } });
fs.writeFileSync(path.join(root, 'index.html'), '<link rel="stylesheet" href="view.css"><div id="root"></div><script src="view.js"></script>');
await app.whenReady();
  try {
    const window = new BrowserWindow({ show: false, width: 1400, height: 900 });
    await window.loadFile(path.join(root, 'index.html'));
    const run = code => window.webContents.executeJavaScript(code);
    const wait = async code => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(`Timed out: ${code}`); };
    await wait("document.querySelector('.timelineRow')!==null");
    const count = await run("document.querySelectorAll('.timelineRow').length");
    assert(count <= 22);
    await run("{const area=document.querySelector('[aria-label=\"Timeline rows\"]');area.scrollTop=area.scrollHeight}");
    await wait("document.querySelector('[aria-label=\"Timeline rows\"]').textContent.includes('Row 4999')");
    await run("[...document.querySelectorAll('.timelineRow button')].find(button=>button.textContent==='Row 4999').click()");
    assert.equal(await run('document.body.dataset.opened'), '4999');
    await run("document.querySelector('[aria-label=\"Next timeline month\"]').click()");
    await wait("document.querySelectorAll('.timelineRow').length===0");
    assert.equal(await run("document.querySelector('[aria-label=\"Timeline rows\"]').scrollTop"), 0);
    await run("document.querySelector('[aria-label=\"Previous timeline month\"]').click()");
    await wait("document.querySelector('.timelineRow')?.textContent.includes('Row 0')");
    await run("[...document.querySelectorAll('button')].find(button=>button.textContent==='First dated item').click()");
    await wait("document.querySelector('.databaseCalendarToolbar strong').textContent.includes('2026') && document.querySelectorAll('.timelineRow').length===0");
    console.log(JSON.stringify({result:'TIMELINE_VIRTUALIZATION_OK', rows:5000,mountedRows:count,lastRowReachable:true,controlledMonthAndEarliestDate:true}));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { app.exit(process.exitCode || 0); }
}
void main().catch(error => { console.error(error); app.exit(1); });
