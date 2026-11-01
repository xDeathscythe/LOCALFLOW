const assert = require('node:assert/strict');
const path = require('node:path');
// The fixture has no model connection, so every step below proves that prepared spaces open without waiting for Niwa.
module.exports = async (page, directory) => {
  const crumb = name => page.locator('.brainHeader .crumb', { hasText: name }).first().click();
  await page.locator('[data-section="niwa"]').click();
  await page.waitForSelector('.door');
  assert.equal(await page.locator('.door').count(), 5);
  assert.equal(await page.locator('.hero .voiceTitle').textContent(), 'A different narrator');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(directory, 'brainstorm-home.png') });

  await page.locator('.door', { hasText: 'Paths' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.seed').length === 3);
  await page.screenshot({ path: path.join(directory, 'brainstorm-seeds.png') });
  await page.getByRole('button', { name: 'Follow this idea' }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.pathNode').length === 6);
  assert((await page.locator('.pathNode strong').first().boundingBox()).width > 100, 'Path titles need readable width');
  await page.getByRole('textbox', { name: 'Your own direction' }).fill('日本語の自分の道');
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pathNode').length === 7);
  assert.equal(await page.locator('.pathTrail li').count(), 2, 'The trail follows the selected branch');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(directory, 'brainstorm-paths.png') });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForSelector('.seeds');
  await page.waitForFunction(async () => (await window.localflow.notesList()).items.some(item => item.label === 'A different narrator'));

  await crumb('Brainstorm space');
  await page.locator('.door', { hasText: 'Idea board' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.starPin').length === 3);
  await page.getByRole('button', { name: 'Open “What connects the house”' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.brainPin').length === 3);
  await crumb('Idea board');
  await page.getByRole('button', { name: 'Start an empty board' }).click();
  for (const text of ['Event A', 'صورة من الماضي']) { await page.getByRole('textbox', { name: 'Pin text', exact: true }).fill(text); await page.getByRole('button', { name: 'Pin', exact: true }).click(); await page.waitForFunction(text => [...document.querySelectorAll('.brainPin strong')].some(n => n.textContent === text) && document.querySelector('[aria-label="Pin text"]').value === '', text); }
  const ids = await page.getByRole('combobox', { name: 'Connect from pin' }).locator('option').evaluateAll(options => options.slice(1).map(o => o.value));
  await page.getByRole('combobox', { name: 'Connect from pin' }).selectOption(ids[0]);
  await page.getByRole('combobox', { name: 'Connect to pin' }).selectOption(ids[1]);
  await page.getByRole('textbox', { name: 'Connection meaning' }).fill('These happened on the same day.');
  await page.locator('.brainConnectPins').getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForSelector('.brainBoardCanvas > svg > g > line', { state: 'attached' });
  const grip = page.getByRole('button', { name: 'Move Event A', exact: true }); await grip.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.brainPin').style.left === '60px');
  await page.getByRole('combobox', { name: 'Connect from pin' }).selectOption('');
  await page.getByRole('combobox', { name: 'Connect to pin' }).selectOption('');
  await page.getByRole('button', { name: 'Draw a connection from Event A', exact: true }).dragTo(page.locator('.brainPin strong').nth(1));
  assert.equal(await page.getByRole('combobox', { name: 'Connect from pin' }).inputValue(), ids[0]);
  assert.equal(await page.getByRole('combobox', { name: 'Connect to pin' }).inputValue(), ids[1]);
  await page.screenshot({ path: path.join(directory, 'brainstorm-board.png') });

  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => { document.documentElement.dataset.theme = await window.localflow.setAppearance(theme); }, theme);
    await crumb('Brainstorm space');
    await page.locator('.door', { hasText: 'Story' }).click();
    assert.equal(await page.locator('.bead').count(), 4, 'Three chapters and the present');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(directory, `brainstorm-story-${theme}.png`) });
  }
  await crumb('Brainstorm space');
  await page.locator('.door', { hasText: 'Challenges' }).click();
  await page.getByRole('button', { name: 'Take this on' }).first().click();
  await page.waitForSelector('.turn.assistant');
  assert.equal(await page.locator('.turn.assistant').textContent(), 'How does this sound?Pin to a board');
  await crumb('Brainstorm space');
  await page.locator('.door', { hasText: 'Free thoughts' }).click();
  assert.equal(await page.locator('.stone').count(), 3);
  await page.getByRole('button', { name: 'Like thought 1', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Like thought 1"]').getAttribute('aria-pressed') === 'true');

  await page.reload(); await page.waitForSelector('.navList');
  await page.locator('[data-section="niwa"]').click(); await page.waitForSelector('.door');
  await page.locator('.door', { hasText: 'Idea board' }).click();
  await page.locator('.pastPages button').filter({ hasText: 'Idea board' }).click();
  assert.equal(await page.locator('.brainPin').count(), 2);
  assert.equal(await page.locator('.brainBoardCanvas > svg > g > line').count(), 1);
  console.log('NATIVE_BRAINSTORM_OK', directory);
};
