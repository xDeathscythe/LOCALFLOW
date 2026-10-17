const assert = require('node:assert/strict');
const path = require('node:path');
// Resting top-edge band centres from the original 400 x 320 Riffle camera, front to back.
const points = [[160.7401,148.7041],[175.6318,141.2582],[190.5234,133.8124],[205.4151,126.3666],[220.3068,118.9207],[235.1984,111.4749],[250.0901,104.0290],[264.9818,96.5832]];
module.exports = async (page, directory) => {
  const fixture = await page.evaluate(async () => {
    const folder = await window.localflow.notesCreate({kind:'folder',label:'Riffle 日本語 العربية'});
    const children = [];
    for (let index=0;index<17;index++) children.push(await window.localflow.notesCreate({
      kind:index%3===0?'folder':index%3===1?'note':'database',
      label:['Planovi za jesen','日本語のメモ','ملاحظات المشروع','Überblick','Белешке'][index%5]+` ${index+1}`,parentId:folder.id,
    }));
    return {folder,children};
  });
  await page.locator('[data-section="notes"]').click();
  const openFolder = async () => { await page.locator('.notesPageTreeRow').filter({hasText:fixture.folder.label}).first().click(); await page.waitForSelector('.riffleCard'); };
  await openFolder();
  const stages=page.locator('.riffleStage'), cards=page.locator('.riffleCard');
  const aim = async (tray,index) => { await stages.nth(tray).scrollIntoViewIfNeeded();const r=await stages.nth(tray).boundingBox();return {x:r.x+points[index][0]/400*r.width,y:r.y+points[index][1]/320*r.height}; };
  assert.deepEqual(await page.locator('.riffleTray').evaluateAll(trays=>trays.map(t=>t.querySelectorAll('.riffleCard').length)),[8,8,1]);
  for(let i=0;i<3;i++) assert.deepEqual(await stages.nth(i).locator('.riffleCard').evaluateAll(nodes=>nodes.map(n=>n.dataset.itemId)),fixture.children.slice(i*8,i*8+8).reverse().map(c=>c.id));
  await stages.first().focus();await page.keyboard.press('ArrowRight');
  assert.equal(await stages.first().getAttribute('data-active-id'),fixture.children[0].id);
  await page.keyboard.press('ArrowRight');assert.equal(await stages.first().getAttribute('data-active-id'),fixture.children[1].id);
  await page.keyboard.press('End');assert.equal(await stages.first().getAttribute('data-active-id'),fixture.children[7].id);
  await page.keyboard.press('Escape');assert.equal(await stages.first().getAttribute('data-active-id'),null);
  for(let index=0;index<8;index++) { const pt=await aim(0,index);await page.mouse.move(pt.x,pt.y);assert.equal(await stages.first().getAttribute('data-active-id'),fixture.children[index].id); }
  await page.waitForTimeout(1050);await page.screenshot({path:path.join(directory,'riffle-dark.png')});
  await page.evaluate(async()=>{document.documentElement.dataset.theme=await window.localflow.setAppearance('light');});await page.waitForTimeout(350);await page.screenshot({path:path.join(directory,'riffle-light.png')});
  await page.evaluate(async()=>{document.documentElement.dataset.theme=await window.localflow.setAppearance('dark');});
  await stages.first().focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.waitForSelector('.noteTitleInput');assert.equal(await page.locator('.noteTitleInput').inputValue(),fixture.children[1].label);
  await openFolder();await stages.first().focus();await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.notesFolderHeading p')?.textContent==='0 items');assert.equal(await cards.count(),0);assert.equal(await stages.count(),1);
  await page.getByRole('button',{name:'New note',exact:true}).last().click();await page.getByRole('textbox',{name:'Note title',exact:true}).fill('Nova beleška');await page.getByRole('button',{name:'Create note',exact:true}).click();await page.waitForSelector('.noteTitleInput');
  await openFolder();await stages.first().focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.waitForSelector('.notesDatabasePage');
  await openFolder();let pt=await aim(2,0);await page.keyboard.down('Control');await page.mouse.click(pt.x,pt.y);await page.keyboard.up('Control');await page.waitForSelector('.noteTitleInput');assert.equal(await page.locator('.noteTitleInput').inputValue(),fixture.children[16].label);assert.equal(await page.getByRole('tab',{name:fixture.folder.label,exact:true}).count(),1);
  await openFolder();pt=await aim(2,0);await page.mouse.click(pt.x,pt.y,{button:'right'});await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});await stages.first().focus();await page.keyboard.press('Home');await page.waitForTimeout(80);
  const shape=await cards.first().locator('path').first().getAttribute('d');await page.waitForTimeout(100);assert.equal(await cards.first().locator('path').first().getAttribute('d'),shape);
  for(const width of [560,1000]) { await page.setViewportSize({width,height:800});assert(await page.locator('.notesFolderView').evaluate(n=>n.scrollWidth<=n.clientWidth+1));await page.locator('.notesFolderView').evaluate(n=>{n.scrollTop=0;});await page.screenshot({path:path.join(directory,`riffle-${width}.png`)}); }
  for(const count of [16,9,8,1,0]) {
    await page.evaluate(async({folderId,keep})=>{const folder=(await window.localflow.notesList()).items.find(item=>item.id===folderId);for(const child of folder.children.slice(keep))await window.localflow.notesRemove(child.id);},{folderId:fixture.folder.id,keep:count});
    await page.waitForFunction(count=>document.querySelectorAll('.riffleCard').length===count,count);assert.equal(await stages.count(),Math.max(1,Math.ceil(count/8)));
  }
  console.log('NATIVE_RIFFLE_ORIGINAL_OK',directory);
};
