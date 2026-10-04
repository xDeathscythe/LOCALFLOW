const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { performance } = require('node:perf_hooks');
const directory = fs.mkdtempSync(path.resolve('runtime/native-check-'));
const profile = path.join(directory, 'profile');
fs.mkdirSync(profile);
const port = 19223;
const launch = performance.now();
const environment={...process.env,LOCALFLOW_APP_ROOT:path.resolve('.'),LOCALFLOW_DEBUG_BRIDGE:'1',LOCALFLOW_USER_DATA:profile,LOCALFLOW_PACKAGED:'1',LOCALFLOW_TEST_NO_INPUT:'1',LOCALFLOW_TEST_NO_WARMUP:'1',WEBVIEW2_USER_DATA_FOLDER:path.join(directory,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --use-fake-device-for-media-stream --autoplay-policy=no-user-gesture-required`};
delete environment.WEBVIEW2_USER_DATA_FOLDER; // Exercise native per-window profile selection.
if(process.argv.includes('--packaged'))delete environment.LOCALFLOW_APP_ROOT;
const processHandle = spawn(path.resolve(process.argv[2] || 'src-tauri/target/debug/localflow-desktop.exe'), [], {
  cwd:path.resolve('.'), windowsHide:true, env:environment,
  stdio:['ignore','pipe','pipe'],
});
let logs=''; processHandle.stdout.on('data', bytes => { logs+=bytes; }); processHandle.stderr.on('data', bytes => { logs+=bytes; });
async function run() {
  let browser;
  for(let i=0;i<200;i++) {
    if(processHandle.exitCode!==null)throw new Error('Native app exited: '+logs);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert(browser,'WebView2 did not start: '+logs);
  try {
    let page;
    for(let i=0;i<100;i++){page=browser.contexts().flatMap(context=>context.pages()).find(page=>/^https?:\/\/tauri\.localhost\/(index\.html)?$/.test(page.url()));if(page)break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert(page,'Native UI page unavailable: '+JSON.stringify(browser.contexts().flatMap(context=>context.pages()).map(page=>page.url())));
    page.on('pageerror', error => { logs+='\n[ui] '+error.message; });
    await page.waitForSelector('.navList',{timeout:30000});
    const usableMs = performance.now()-launch;
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
    await assert.rejects(()=>page.evaluate(()=>window.localflow.setAppearance('__proto__')),/Unknown appearance/);
    for(const theme of ['light','static-white','dark','static-black','dark'])assert.equal(await page.evaluate(theme=>window.localflow.setAppearance(theme),theme),theme);
    if(process.argv.includes('--glass')) {
      for(const theme of ['dark','light','static-black','static-white']) {
        await page.evaluate(async theme=>{document.documentElement.dataset.theme=await window.localflow.setAppearance(theme);},theme);
        const material=spawnSync('powershell.exe',['-NoProfile','-File',path.resolve('tests/native-material.ps1'),'-NativeProcessId',String(processHandle.pid),'-ImagePath',path.join(directory,`main-${theme}.png`),...(theme.startsWith('static-')?['-Opaque']:[])],{windowsHide:true,encoding:'utf8'});
        assert.equal(material.status,0,material.stderr||material.stdout);
        console.log('NATIVE_GLASS_DESKTOP_PIXELS_OK',theme,material.stdout.trim());
      }
      await page.evaluate(async()=>{document.documentElement.dataset.theme=await window.localflow.setAppearance('dark');});
    }
    const note = await page.evaluate(()=>window.localflow.notesCreate({label:'日本語 العربية',content:'Native persisted note',document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Native persisted note'}]}]}}));
    await page.locator('[data-section="notes"]').click();
    await page.waitForSelector('.noteProse',{timeout:15000});
    await page.evaluate(()=>document.querySelector('.noteProse').editor.commands.insertContent({type:'blockMath',attrs:{latex:'E = mc^2'}}));
    await page.waitForSelector('.block-math-inner .katex');
    assert.match(await page.evaluate(()=>document.querySelector('.noteProse').editor.getMarkdown()),/E = mc\^2/,'Lazy math keeps rendering and Markdown serialization.');
    await page.locator('.noteProse').click();
    await page.evaluate(()=>{
      const editor=document.querySelector('.noteProse').editor;
      window.serializationCount=0;const serialize=editor.getMarkdown.bind(editor);
      editor.getMarkdown=()=>{window.serializationCount++;return serialize();};
      editor.commands.setTextSelection(editor.state.doc.content.size-1);
      for(let i=0;i<100;i++)editor.commands.insertContent('語');
    });
    assert.equal(await page.evaluate(()=>window.serializationCount),0,'Typing does not serialize the entire note.');
    await page.evaluate(()=>new Promise((resolve,reject)=>{const event=new CustomEvent('localflow-save-before-quit',{cancelable:true,detail:{resolve,reject}});if(window.dispatchEvent(event))reject(Error('No save handler'));}));
    assert.equal(await page.evaluate(()=>window.serializationCount),1,'Flush serializes the draft once.');
    await page.keyboard.press('End'); await page.keyboard.type(' edits');
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(id=>window.localflow.notesRead(id),note.id);
    assert.match(saved.content,/edits/);
    await assert.rejects(()=>page.evaluate(note=>window.localflow.notesSave({...note,content:'Stale overwrite'}),note),/changed elsewhere/);
    const database=await page.evaluate(async()=>{
      const item=await window.localflow.notesCreate({kind:'database',label:'Native database 日本語'});
      await window.localflow.notesDatabaseAddRow({id:item.id,label:'First row'});return item;
    });
    await page.locator('.notesPageTreeRow').filter({hasText:'Native database 日本語'}).first().click();
    await page.waitForSelector('.notesDatabaseTable');
    await page.locator('.notesDatabaseTable tbody input').first().fill('مرحبا row');
    await page.locator('[aria-label="New row"]').click();
    await page.waitForFunction(async id=>(await window.localflow.notesDatabaseRead(id)).rows.some(row=>row.values.title==='مرحبا row'),database.id);
    await page.locator('.notesPageTreeRow').filter({hasText:'日本語 العربية'}).first().click();await page.waitForSelector('.noteProse');
    assert(fs.existsSync(path.join(profile,'notes/workspace.sqlite')));
    const audio = await page.evaluate(async()=>window.localflow.saveAudioBuffer({buffer:new Uint8Array([1,2,3,4]).buffer,extension:'.wav'}));
    assert.deepEqual([...fs.readFileSync(audio)],[1,2,3,4]);
    await assert.rejects(()=>page.evaluate(()=>window.localflow.saveAudioBuffer({buffer:new Uint8Array([1]).buffer,extension:'../../escape'})),/Unsupported/);
    const pdf = path.join(directory,'test.pdf');
    await page.evaluate(pdf=>window.__TAURI__.core.invoke('native_call',{method:'print-pdf',args:[{html:'<!doctype html><html><body><h1>日本語 العربية</h1><p>LocalFlow native PDF</p></body></html>',path:pdf}]}),pdf);
    assert.equal(fs.readFileSync(pdf).subarray(0,5).toString(),'%PDF-');
    const mathPdf = path.join(directory, 'math.pdf');
    const mathHtml = await require('../host/notes/pdf.cjs').printableHtml(path.join(directory, 'notes'), {
      title: 'Math PDF', html: require('katex').renderToString('\\sqrt{\\frac{a}{b}}', { displayMode: true, trust: false }),
    });
    await page.evaluate(({ html, path }) => window.__TAURI__.core.invoke('native_call', { method: 'print-pdf', args: [{ html, path }] }), { html: mathHtml, path: mathPdf });
    assert(fs.readFileSync(mathPdf).includes(Buffer.from('/FontFile')), 'Math PDF embeds its fonts without network requests');
    const imageBytes=[...fs.readFileSync(path.resolve('assets/localflow-logo-32.png'))];
    const image=await page.evaluate(async bytes=>(await window.localflow.notesUploadAssets([{name:'日本語.png',data:new Uint8Array(bytes)}]))[0],imageBytes);
    const url=image.url.replace(/^localflow-asset:\/\/([^/]+)\//,'http://localflow-asset.localhost/$1/');
    assert.equal(await page.evaluate(url=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth);image.onerror=()=>resolve(0);image.src=url;}),url),32,'Imported images load through the native asset protocol.');
    const binary=await page.evaluate(async()=>{const bytes=new Uint8Array(10_000_000);bytes.fill(97);const start=performance.now();const asset=(await window.localflow.notesUploadAssets([{name:'日本語 العربية.bin',data:bytes}]))[0];return {asset,ms:performance.now()-start};});
    const binaryUrl=binary.asset.url.replace(/^localflow-asset:\/\/([^/]+)\//,'http://localflow-asset.localhost/$1/');
    const range=await page.evaluate(async url=>{const response=await fetch(url,{headers:{Range:'bytes=100-109'}});return {status:response.status,text:await response.text(),range:response.headers.get('Content-Range'),etag:response.headers.get('ETag')};},binaryUrl);
    assert.equal(range.status,206);assert.equal(range.text,'aaaaaaaaaa');assert.equal(range.range,'bytes 100-109/10000000');
    const cached=await page.evaluate(async ({url,etag})=>(await fetch(url,{headers:{'If-None-Match':etag}})).status,{url:binaryUrl,etag:range.etag});assert.equal(cached,304);
    console.log('NATIVE_BINARY_UPLOAD_RANGE_CACHE_OK',JSON.stringify({megabytes:10,ms:+binary.ms.toFixed(1)}));
    assert.equal(await page.evaluate(url=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src=url;}),url.replace(/\/[^/]+$/,'/%2e%2e/%2e%2e/index.json')),false,'Asset traversal is refused.');
    const capture=await page.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'capture-screen',args:[{}]}));
    assert.equal(capture.content[1].mimeType,'image/jpeg');assert.equal(Buffer.from(capture.content[1].data,'base64')[0],255);
    const offer=await page.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'cleanup-transport',args:['offer',null]}));
    assert.match(offer,/m=audio/);await page.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'cleanup-close',args:[]}));
    const recorded=await page.evaluate(async()=>{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const recorder=new MediaRecorder(stream);const parts=[];
      recorder.ondataavailable=event=>parts.push(event.data);
      const finished=new Promise(resolve=>recorder.onstop=()=>resolve(parts.reduce((total,part)=>total+part.size,0)));
      recorder.start();await new Promise(resolve=>setTimeout(resolve,300));recorder.stop();const bytes=await finished;stream.getTracks().forEach(track=>track.stop());return bytes;
    });assert(recorded>0,'Native microphone permission and MediaRecorder work with the synthetic test device.');
    await require('./native-voice-check.cjs')(page);
    const oldClipboard=spawnSync('powershell.exe',['-NoProfile','-Command','[Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string](Get-Clipboard -Raw))))'],{windowsHide:true,encoding:'utf8'});
    await page.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'edge-action',args:['notes']}));
    await page.waitForTimeout(300);
    await page.evaluate(()=>{const input=document.createElement('textarea');input.id='native-paste-proof';input.style.cssText='position:fixed;top:40px;left:350px;z-index:99999;width:500px;height:60px';document.body.append(input);});
    await page.locator('#native-paste-proof').click();
    const foreground=spawnSync('powershell.exe',['-NoProfile','-Command',`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class LocalFlowForeground{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}'; [uint32]$owner=0;[void][LocalFlowForeground]::GetWindowThreadProcessId([LocalFlowForeground]::GetForegroundWindow(),[ref]$owner);[Console]::Write($owner)`],{windowsHide:true,encoding:'utf8'});
    assert.equal(foreground.status,0,foreground.stderr);
    assert.equal(Number(foreground.stdout),processHandle.pid,'Only paste into the owned test application.');
    try{
      assert.equal(await page.evaluate(()=>window.localflow.pasteText('日本語 مرحبا Živeli')),true);
      await page.waitForFunction(()=>document.querySelector('#native-paste-proof').value==='日本語 مرحبا Živeli');
    }finally{
      if(oldClipboard.status===0)await page.evaluate(text=>window.localflow.copyText(text),Buffer.from(oldClipboard.stdout.trim(),'base64').toString('utf8'));
      await page.evaluate(()=>document.querySelector('#native-paste-proof').remove());
    }
    await page.evaluate(()=>window.localflow.setEdgeSettings({enabled:true,autoHide:true}));
    let edge;
    for(let i=0;i<50;i++){edge=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().endsWith('/edge.html'));if(edge)break;await page.waitForTimeout(50);}
    assert(edge);await edge.waitForSelector('body.collapsed');
    const checkShape=(surface,name)=>{
      const material=spawnSync('powershell.exe',['-NoProfile','-File',path.resolve('tests/native-material.ps1'),'-NativeProcessId',String(processHandle.pid),'-Surface',surface,'-ImagePath',path.join(directory,name+'.png')],{windowsHide:true,encoding:'utf8'});
      assert.equal(material.status,0,material.stderr||material.stdout);
      console.log('NATIVE_SHAPED_WINDOW_PIXELS_OK',name,material.stdout.trim());
    };
    if(process.argv.includes('--glass')) {
      for(const theme of ['dark','light','static-black','static-white']) {
        await page.evaluate(theme=>window.localflow.setAppearance(theme),theme);
        for(const expanded of [true,false]) {
          await page.evaluate(expanded=>window.localflow.setEdgeSettings({enabled:true,autoHide:!expanded}),expanded);
          await edge.waitForFunction(expanded=>document.body.classList.contains('collapsed')!==expanded,expanded);
          await edge.waitForTimeout(700);
          checkShape('edge',`edge-${theme}-${expanded?'expanded':'collapsed'}`);
        }
      }
      await page.evaluate(()=>window.localflow.setAppearance('dark'));
    }
    await edge.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'edge-hover',args:[1]}));
    await edge.waitForFunction(()=>!document.body.classList.contains('collapsed'));
    await edge.locator('[data-action="notes"]').click();
    await assert.rejects(()=>edge.evaluate(()=>window.__TAURI__.core.invoke('host_call',{method:'notes-list',args:[]})),/main window/);
    await page.evaluate(async()=>{await window.localflow.setEdgeSettings({enabled:false,autoHide:true});await window.__TAURI__.core.invoke('native_call',{method:'window-hide',args:[]});});
    await page.waitForTimeout(200);
    await page.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'overlay-state',args:[{recording:true,starting:false,elapsedSeconds:65}]}));
    let overlay;
    for(let i=0;i<50;i++){overlay=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().endsWith('/recording.html'));if(overlay)break;await page.waitForTimeout(50);}
    assert(overlay);await overlay.waitForFunction(()=>document.querySelector('output').textContent==='1:05');
    const processGroups=spawnSync('powershell.exe',['-NoProfile','-Command',`$all=Get-CimInstance Win32_Process;$owned=[Collections.Generic.HashSet[int]]::new();[void]$owned.Add(${processHandle.pid});do{$previous=$owned.Count;foreach($item in $all){if($owned.Contains([int]$item.ParentProcessId)){[void]$owned.Add([int]$item.ProcessId)}}}while($owned.Count -ne $previous);$web=@($all|Where-Object{$owned.Contains([int]$_.ProcessId)-and $_.Name -eq 'msedgewebview2.exe'});@{browsers=@($web|Where-Object{$_.CommandLine -notmatch '--type='}).Count;gpu=@($web|Where-Object{$_.CommandLine -match '--type=gpu-process'}).Count}|ConvertTo-Json -Compress`],{windowsHide:true,encoding:'utf8'});
    assert.equal(processGroups.status,0,processGroups.stderr);const groups=JSON.parse(processGroups.stdout);assert.equal(groups.browsers,1);assert.equal(groups.gpu,1);console.log('NATIVE_SHARED_WEBVIEW_PROCESS_GROUP_OK',JSON.stringify(groups));
    if(process.argv.includes('--glass'))checkShape('recording','recording');
    await overlay.locator('button').click();
    await page.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'overlay-state',args:[{recording:false,starting:false}]}));
    await edge.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'edge-action',args:['notes']}));
    await page.screenshot({path:path.join(directory,'notes.png')});
    if(process.argv.includes('--inference')){
      const result=await page.evaluate(file=>window.localflow.transcribeFile({path:file,options:{cleanup:false,cleanupLevel:'none'}}),path.resolve('tests/fixtures/dictation.wav'));
      assert.match(result.rawText.toLowerCase(),/orange bicycle/);assert.match(result.rawText.toLowerCase(),/library/);
      console.log('NATIVE_LARGE_V3_TRANSCRIPTION_OK',result.rawText);
    }
    assert(!logs.includes('\n[ui]'),'Native UI must not report an uncaught execution error.');
    await page.evaluate(()=>window.__TAURI__.core.invoke('native_call',{method:'application-quit',args:[]}));
    for(let i=0;i<100&&processHandle.exitCode===null;i++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(processHandle.exitCode,0,'Graceful native shutdown must flush notes and close feature processes.');
    console.log(JSON.stringify({result:'NATIVE_DESKTOP_OK',version:require('../package.json').version,usableMs:+usableMs.toFixed(1),profile,checks:['real WebView2 UI','rich note save','stale revision rejected','binary audio','audio traversal rejected','native PDF','asset protocol and traversal refusal','native screen capture','hidden WebRTC transport','edge hover/navigation','auxiliary-window permissions','background recording overlay','graceful flush and exit']}));
  } finally { await browser.close(); }
}
const timeout=setTimeout(()=>{console.error('Native integration check timed out',logs.slice(-6000));process.exitCode=1;spawnSync('taskkill.exe',['/PID',String(processHandle.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});},process.argv.includes('--inference')?180000:process.argv.includes('--glass')?90000:55000);
run().catch(error=>{console.error(error,logs.slice(-6000));process.exitCode=1;}).finally(()=>{clearTimeout(timeout);spawnSync('taskkill.exe',['/PID',String(processHandle.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(path.join(directory,'host.log'),logs);});
