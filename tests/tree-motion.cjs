const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function checkTreeMotion(page, directory) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async () => {
    const root = await window.localflow.notesCreate({ kind: 'folder', label: '資料 العربية' });
    const nested = await window.localflow.notesCreate({ kind: 'folder', label: 'Подфолдер', parentId: root.id });
    await window.localflow.notesCreate({ label: '子ページ', parentId: nested.id });
    await window.localflow.notesCreate({ label: 'ملاحظة', parentId: root.id });
  });
  const folder = page.locator('.notesPageTreeRow').filter({ hasText: '資料 العربية' });
  const notes = folder.locator('..');
  async function toggle(branch) {
    return branch.evaluate(async element => {
      const frames = [];
      const row = element.querySelector(':scope > summary, :scope > .notesPageTreeRow');
      const initial = element.open ?? (row.getAttribute('aria-expanded') === 'true');
      row.click();
      const start = performance.now();
      while (performance.now() - start < 300) {
        await new Promise(requestAnimationFrame);
        const content = element.querySelector(':scope > .notesTreeChildren');
        const style = element.matches('.projectFolder') ? getComputedStyle(element, '::details-content') : content && getComputedStyle(content);
        frames.push({ height: parseFloat(style?.height || '0'), opacity: Number(style?.opacity || '0') });
      }
      return { initial, open: element.open ?? (row.getAttribute('aria-expanded') === 'true'), frames };
    });
  }
  async function check(branch, name) {
    const isOpen = () => branch.evaluate(element => element.open ?? (element.querySelector(':scope > .notesPageTreeRow').getAttribute('aria-expanded') === 'true'));
    if (await isOpen()) await toggle(branch);
    const opening = await toggle(branch), closing = await toggle(branch);
    assert(opening.open && !closing.open, `${name}: toggles in both directions`);
    const height = opening.frames.at(-1).height;
    assert(height > 20, `${name}: content reaches its natural height`);
    for (const motion of [opening, closing]) {
      assert(motion.frames.some(frame => frame.height > 1 && frame.height < height - 1), `${name}: height interpolates`);
      assert(motion.frames.some(frame => frame.opacity > 0 && frame.opacity < 1), `${name}: content fades`);
    }
    assert.equal(closing.frames.at(-1).height, 0, `${name}: closed content takes no space`);
    await branch.evaluate(async element => {
      for (let i = 0; i < 3; i++) { element.querySelector(':scope > summary, :scope > .notesPageTreeRow').click(); await new Promise(resolve => setTimeout(resolve, 40)); }
    });
    await page.waitForTimeout(300);
    assert(await isOpen(), `${name}: rapid reversal keeps the final state`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await toggle(branch);
    assert.equal(reduced.frames.at(-1).height, 0, `${name}: reduced motion closes`);
    assert(!reduced.frames.some(frame => frame.height > 0 && frame.height < height), `${name}: reduced motion has no intermediate heights`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log('TREE_MOTION_OK', name, JSON.stringify({ height, openingFrames: opening.frames.length, closingFrames: closing.frames.length }));
  }
  await check(notes, 'Notes');
  assert.equal(await notes.locator('[role="group"]').count(), 0, 'Closed branches release their rendered descendants');
  await folder.press('Enter');
  await page.waitForTimeout(250);
  assert.equal(await folder.getAttribute('aria-expanded'), 'true');
  const nested = page.locator('.notesPageTreeRow').filter({ hasText: 'Подфолдер' });
  await nested.press('Space');
  await page.waitForTimeout(250);
  assert.equal(await nested.getAttribute('aria-expanded'), 'true');
  await folder.press('ArrowLeft');
  await page.waitForTimeout(250);
  assert.equal(await nested.isVisible(), false, 'Closed descendants are hidden');
  await page.locator('[aria-label="Search notes"]').fill('子ページ');
  await page.waitForTimeout(250);
  assert(await page.locator('.notesPageTreeRow').filter({ hasText: '子ページ' }).isVisible(), 'Search reveals nested matches');
  await page.locator('[aria-label="Search notes"]').fill('');
  await folder.locator('.notesTreeExpand').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(directory, 'notes-tree.png') });
  await page.locator('[data-section="niwa"]').click();
  const project = page.locator('.projectFolder').first();
  await project.waitFor();
  await check(project, 'Projects');
  await project.locator('summary').press('Enter');
  await page.waitForTimeout(250);
  assert(await project.locator('.projectChat').first().isVisible(), 'Keyboard opens project chats');
  await page.screenshot({ path: path.join(directory, 'projects-tree.png') });
  await page.locator('[data-section="notes"]').click();
};
