const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async (page,browser,directory) => {
  const invoke = (method,value) => page.evaluate(({method,value})=>window.__TAURI__.core.invoke('native_call',{method,args:[value]}),{method,value});
  async function overlay(mode) {
    for(let i=0;i<120;i++) {
      const all=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().endsWith('/text-tools.html') && !p.isClosed());
      for(const candidate of all) { try { if(await candidate.evaluate(()=>window.TEXT_TOOLS?.mode)===mode) return candidate; } catch {} }
      await new Promise(r=>setTimeout(r,100));
    }
    throw Error('Missing '+mode+' overlay; pages: '+JSON.stringify(browser.contexts().flatMap(c=>c.pages()).map(p=>p.url())));
  }
  const board=page.locator('.scrubBoardPage');
  const editor=board.locator('.noteProse');
  await page.getByRole('button',{name:'Scrub board',exact:true}).click();
  await editor.fill('日本語 العربية Srpski temporary draft');
  await board.getByRole('textbox',{name:'Note title',exact:true}).fill('Text tools check');
  assert.equal((await page.evaluate(()=>window.localflow.notesList())).items.length,0);
  assert.equal(browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().endsWith('/text-tools.html')).length,0,'Board is a main-window page');
  await page.screenshot({path:path.join(directory,'scrub-board.png')});
  await board.getByRole('button',{name:'Save note',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.scrubBoardPage [role=status]').textContent==='Saved in Notes.');
  const notes=(await page.evaluate(()=>window.localflow.notesList())).items;
  assert.equal(notes.length,1);assert.equal(notes[0].label,'Text tools check');
  const saved=await page.evaluate(id=>window.localflow.notesRead(id),notes[0].id);
  assert.match(saved.content,/日本語 العربية Srpski temporary draft/);assert(saved.document);
  await page.locator('[data-section="notes"]').click();
  await page.getByRole('button',{name:'Scrub board',exact:true}).click();
  assert.equal((await editor.innerText()).trim(),'');
  await invoke('text-tools-open',{mode:'board',text:'New selection'});
  await page.waitForFunction(()=>document.querySelector('.scrubBoardPage .noteProse').textContent==='New selection');
  await editor.fill('Unsaved draft');await page.locator('[data-section="notes"]').click();
  const contents=await page.evaluate(async()=>{const items=(await window.localflow.notesList()).items;return Promise.all(items.filter(n=>n.kind==='note').map(async n=>(await window.localflow.notesRead(n.id)).content));});
  assert(contents.every(text=>!text.includes('Unsaved draft')));
  await assert.rejects(()=>invoke('text-tools-copy',''),/No readable text/);
  await assert.rejects(()=>invoke('text-tools-run',{action:'grammar',text:'She go to school.'}),/ChatGPT/);
  // Native OCR recognizes the whole image and supplies usable geometry without OAuth.
  const image=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=260;
    const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1000,260);
    context.fillStyle='black';context.font='36px Segoe UI';context.fillText('Select Copy recognizes the whole screen.',35,80);
    context.fillText('Drag across words and copy the selection.',35,150);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const recognized=await invoke('text-tools-recognize',{image});
  assert.match(recognized.lines.map(line=>line.text).join(' '),/Select Copy recognizes the whole screen/);
  assert(recognized.lines.every(line=>line.words.every(word=>word.width>0&&word.height>0)));
  await page.getByRole('button',{name:'Select Copy',exact:true}).click();
  const capture=await overlay('capture');
  await capture.locator('img').evaluate(img=>img.decode());
  await capture.waitForFunction(()=>document.querySelector('.status').textContent!=='Reading screen�',{},{timeout:20000});
  assert.equal(await capture.locator('.aura').count(),1);
  assert(await capture.locator('.ocrWord').count()>0,'Whole screen recognized before mouse selection');
  assert.equal(await capture.locator('.selection').count(),0,'No image crop UI');
  const word=capture.locator('.ocrWord').filter({hasText:/[A-Za-z]{4}/}).first();
  const box=await word.boundingBox();
  await capture.mouse.move(box.x+1,box.y+box.height/2);await capture.mouse.down();
  await capture.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:8});await capture.mouse.up();
  const selected=await capture.evaluate(()=>window.getSelection().toString());
  assert(selected.trim(),'Mouse drag selects actual recognized text');
  await capture.screenshot({path:path.join(directory,'select-copy-selection.png')});
  await capture.getByRole('button',{name:'Copy',exact:true}).click();
  for(let i=0;i<50&&!capture.isClosed();i++)await new Promise(r=>setTimeout(r,100));
  assert(capture.isClosed(),'Copy exits capture');
  const toast=await overlay('toast');
  assert.equal(await toast.locator('.check').getAttribute('aria-label'),'Copied to clipboard');
  await invoke('text-tools-close','text-toast');
  const clipboard=()=>require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-Command','[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'],{windowsHide:true,encoding:'utf8'}).trim();
  assert.equal(clipboard(),selected.trim(),'Clipboard contains the selected OCR text');
  await page.getByRole('button',{name:'Select Copy',exact:true}).click();
  const cancelled=await overlay('capture');
  await cancelled.keyboard.press('Escape').catch(error=>{if(!cancelled.isClosed())throw error;});
  for(let i=0;i<50&&!cancelled.isClosed();i++)await new Promise(r=>setTimeout(r,100));
  assert(cancelled.isClosed(),'Escape exits even while recognizing');
  assert.equal(clipboard(),selected.trim(),'Escape preserves the clipboard');
  const config=await page.evaluate(()=>window.localflow.getShortcuts());
  assert.deepEqual(config['select-copy'].keys,[0x71,0x72]);
  console.log('NATIVE_TEXT_TOOLS_OK',directory);
};
