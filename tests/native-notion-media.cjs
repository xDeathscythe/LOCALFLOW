const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Opt-in native integration check: the real Notion assets require network access.
module.exports = async function checkNotionMedia(page, directory) {
  const { readNotionDirectory } = await import('../host/notes/notion-import.mjs');
  const root = path.join(directory, 'notion-media');
  fs.mkdirSync(root);
  const cover = 'https://app.notion.com/images/page-cover/gradients_3.png';
  const icon = 'https://app.notion.com/icons/die3_gray.svg';
  const inline = 'https://app.notion.com/icons/target_gray.svg';
  const emoji = '🌿🧑🏽‍💻🇷🇸';
  fs.writeFileSync(path.join(root, 'Media aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html'), `<article><header><img class="page-cover-image" src="${cover}"><div class="page-header-icon"><img src="${icon}"></div><h1 class="page-title">Notion media 日本語</h1></header><div class="page-body"><p><a href="Emoji bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html"><img class="icon" src="${inline}"> ${emoji} العربية 日本語</a></p><figure><img src="${cover}"></figure></div></article>`);
  fs.writeFileSync(path.join(root, 'Emoji bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html'), `<article><header><div class="page-header-icon">${emoji}</div><h1 class="page-title">Notion emoji العربية</h1></header><div class="page-body"><p>${emoji}</p></div></article>`);
  const bundle = readNotionDirectory(root, 'media-regression');
  const imported = bundle.items[0].children.flatMap(folder => folder.children);
  const notes = [];
  for (const item of imported) {
    notes.push(await page.evaluate(async item => {
      const created = await window.localflow.notesCreate(item);
      return window.localflow.notesSave({ ...await window.localflow.notesRead(created.id), presentation: item.presentation });
    }, item));
  }
  const media = notes.find(note => note.label === 'Notion media 日本語');
  const emojiNote = notes.find(note => note.label === 'Notion emoji العربية');
  assert.equal(media.presentation.cover, cover);
  assert.equal(media.presentation.icon, icon);
  assert.equal(emojiNote.presentation.iconText, emoji);
  await page.locator('.notesPageTreeRow').filter({ hasText: media.label }).first().click();
  await page.waitForSelector(`.richNoteEditor[data-note-id="${media.id}"] .noteProse`);
  await page.waitForSelector('.notePageCover');
  const selectors = ['.notePageCover', '.notePageIcon img', '.noteProse img[data-type="page-icon"]', '.noteProse img[data-asset-src]'];
  await page.waitForFunction(selectors => selectors.every(selector => {
    const image = document.querySelector(selector);
    return image?.complete && image.naturalWidth > 0;
  }), selectors, { timeout: 20000 });
  for (const [selector, src] of selectors.map((selector, i) => [selector, [cover, icon, inline, cover][i]])) {
    assert.equal(await page.locator(selector).first().getAttribute('src'), src);
  }
  assert.match(await page.locator('.noteProse').innerText(), /🌿🧑🏽‍💻🇷🇸/u);
  await page.screenshot({ path: path.join(directory, 'notion-media.png') });
  await page.evaluate(() => document.querySelector('.noteProse').editor.commands.insertContent(' ✨'));
  await page.evaluate(() => new Promise((resolve, reject) => {
    const event = new CustomEvent('localflow-save-before-quit', { cancelable: true, detail: { resolve, reject } });
    if (window.dispatchEvent(event)) reject(Error('No save handler'));
  }));
  const saved = await page.evaluate(id => window.localflow.notesRead(id), media.id);
  assert(saved.document.content.some(node => node.type === 'paragraph' && node.content?.some(child => child.type === 'pageIcon' && child.attrs.src === inline)), 'Inline icon URL survives rich note saving');
  assert.equal(saved.presentation.cover, cover);
  assert.equal(saved.presentation.icon, icon);
  await page.locator('.notesPageTreeRow').filter({ hasText: emojiNote.label }).first().click();
  await page.waitForFunction(emoji => document.querySelector('.notePageIcon span')?.textContent === emoji, emoji);
  await page.locator('.notesPageTreeRow').filter({ hasText: media.label }).first().click();
  await page.waitForSelector(`.richNoteEditor[data-note-id="${media.id}"] .noteProse`);
  await page.waitForFunction(selectors => selectors.every(selector => document.querySelector(selector)?.naturalWidth > 0), selectors);
  console.log('NATIVE_NOTION_MEDIA_OK: imported HTTPS cover, SVG page/inline icons, image, Unicode emoji, save and reopen');
};
