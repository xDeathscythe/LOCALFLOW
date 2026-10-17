import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrainstorm } from '../host/brainstorm.mjs';
import { createNotesStore } from '../host/notes-store.mjs';
import { storeUploads } from '../host/notes/uploads.mjs';

const directory = mkdtempSync(join(tmpdir(), 'localflow-brainstorm-'));
const notes = createNotesStore(directory);
const source = notes.create({ label: '日本語 العربية', content: 'A writer tries a different point of view.' });
let fail = false, timestamp = 1000000, calls = [];
const context = async () => ({ history: [{ id: 'chat-1', role: 'user', content: 'My earlier story' }], memory: { documents: {} } });
const idea = { title: '日本語 العربية Српски', body: 'Explore another perspective', sources: [source.id, 'chat-1', 'invented-id'] };
const branches = Array.from({ length: 5 }, (_, i) => ({ title: `方向 ${i}`, body: `الرواية ${i}` }));
const prepared = {
  idea: { idea, origin: 'From a note', whyNow: 'It is recent', opening: 'Shall we start?' },
  seeds: { seeds: [0, 1, 2].map(() => ({ ...idea, branches })) },
  chapters: { chapters: [0, 1, 2].map(i => ({ title: `Chapter ${i}`, when: 'Earlier', body: 'Evidence', sources: ['chat-1'] })), patterns: [{ title: 'A pattern', body: 'Tentative' }, { title: 'Another', body: 'Tentative' }], continuations: [0, 1, 2].map(i => ({ title: `Next ${i}`, body: 'Possible', question: 'What fits?' })) },
  suggestions: { wins: [idea], struggles: [], suggestions: [0, 1, 2].map(i => ({ title: `Challenge ${i}`, why: 'Fits', firstStep: 'One paragraph', opening: 'How does this sound?' })) },
  pins: { title: 'Starter board', question: 'What links these?', pins: [idea, idea, idea], links: [{ from: 0, to: 1, label: 'Same theme' }, { from: 2, to: 2, label: 'Self' }, { from: 0, to: 5, label: 'Missing' }] },
  thoughts: { thoughts: [0, 1, 2].map(() => ({ ...idea, opening: 'A first reply' })) },
};
const generate = async value => {
  calls.push(value); if (fail) throw new Error('Offline');
  const key = Object.keys(prepared).find(name => value.outputSchema?.properties[name]);
  if (key) return JSON.stringify(prepared[key]);
  if (value.outputSchema) return JSON.stringify({ branches });
  return 'What changed for you today? Consider another point of view if it feels useful.';
};
const open = () => createBrainstorm({ directory, notes, context, generate, now: () => timestamp });
let service = open();
try {
  await service.prepareAll();
  let ready = service.snapshot();
  assert.deepEqual(Object.keys(ready.prepared).sort(), ['board', 'challenges', 'paths', 'present', 'story', 'thoughts']);
  assert.deepEqual(ready.prepared.present.data.idea.sources, [source.id, 'chat-1'], 'Unknown citations are dropped');
  assert.equal(ready.prepared.present.sources[source.id].label, '日本語 العربية');
  assert.equal(ready.prepared.board.data.links.length, 1, 'Self and missing board links are dropped');
  assert(calls.every(call => call.timeoutMs === 240000));
  const count = calls.length;
  await service.prepareAll();
  assert.equal(calls.length, count, 'Fresh modules are not regenerated');
  for (const [mode, index] of [['present', 0], ['paths', 1], ['story', 2], ['challenges', 0], ['board', 0], ['thoughts', 2]]) {
    ready = await service.call('open', { mode, index, generatedAt: service.snapshot().prepared[mode].generatedAt });
    const opened = ready.sessions.find(s => s.id === ready.openedId);
    assert.equal(opened.mode, mode);
    if (mode === 'paths') assert.equal(opened.nodes.length, 6);
    else if (mode === 'board') assert.equal(opened.edges.length, 1);
    else assert.equal(opened.messages[0].role, 'assistant');
  }
  assert.equal(calls.length, count, 'Opening a prepared module never waits for a model turn');
  const thoughtsAt = service.snapshot().prepared.thoughts.generatedAt;
  assert.equal((await service.call('open', { mode: 'thoughts', index: 2, generatedAt: thoughtsAt })).sessions.length, 6, 'Reopening a suggestion returns its page');
  await assert.rejects(() => service.call('open', { mode: 'thoughts', index: 4, generatedAt: thoughtsAt }), /no longer available/);
  await assert.rejects(() => service.call('open', { mode: 'thoughts', index: 0, generatedAt: 1 }), /refreshed/);
  assert(service.snapshot().seq > ready.seq, 'Every snapshot is ordered');
  let state = await service.call('create', { mode: 'paths', title: 'قصة جديدة', seed: '日本語' });
  const id = state.sessions.at(-1).id;
  state = await service.call('branch', { id, title: 'البدء', body: 'Почетак' });
  const root = state.sessions.at(-1).selectedId;
  state = await service.call('expand', { id, nodeId: root });
  assert.equal(state.sessions.at(-1).nodes.filter(n => n.parentId === root).length, 5);
  await assert.rejects(() => service.call('expand', { id, nodeId: root }), /already/);
  await assert.rejects(() => service.call('branch', { id, parentId: 'missing', title: 'x', body: 'y' }), /not found/);
  state = await service.call('branch', { id, parentId: root, title: 'My own direction', body: '日本語の自由な方向' });
  assert.equal(state.sessions.at(-1).nodes.length, 7);
  state = await service.call('save-note', { id });
  const noteId = state.sessions.at(-1).noteId;
  assert(notes.read(noteId).content.includes('日本語の自由な方向'));
  await service.call('save-note', { id });
  notes.save({ ...notes.read(noteId), content: 'Independent user edit' });
  await assert.rejects(() => service.call('save-note', { id }), /edited separately/);
  assert.equal(notes.read(noteId).content, 'Independent user edit');
  await service.call('copy-note', { id });
  state = await service.call('create', { mode: 'board', title: 'Evidence' });
  const board = state.sessions.at(-1).id;
  for (const pinId of ['one', 'two']) await service.call('pin', { id: board, pin: { id: pinId, kind: 'text', title: pinId, body: 'Evidence', x: 40, y: 40 } });
  await assert.rejects(() => service.call('connect', { id: board, from: 'one', to: 'one', label: 'No' }), /different/);
  await service.call('connect', { id: board, from: 'one', to: 'two', label: 'Same event' });
  await assert.rejects(() => service.call('pin', { id: board, pin: { id: 'bad', kind: 'link', title: 'bad', body: '', url: 'javascript:alert(1)', x: 0, y: 0 } }), /web link/);
  service = open();
  assert.equal(service.snapshot().sessions.at(-1).edges.length, 1);
  state = await service.call('unpin', { id: board, pinId: 'one' });
  assert.equal(state.sessions.at(-1).edges.length, 0);
  state = await service.call('create', { mode: 'challenges', title: 'Write again' });
  const challenge = state.sessions.at(-1).id;
  assert.equal(state.sessions.at(-1).nextCheckIn, timestamp + 86400000);
  timestamp += 2 * 86400000;
  await service.call('chat', { id: challenge, text: '今日は一段落を書いた' });
  assert.equal(service.snapshot().sessions.at(-1).messages.length, 2);
  await service.call('feedback', { id: 'thought-one', title: 'A thought', body: 'Look again', rating: -1 });
  await service.call('chat', { id: challenge, text: 'I want a gentler direction.' });
  assert(JSON.parse(calls.at(-1).text).context.feedback.some(f => f.rating === -1));
  const before = service.snapshot(); fail = true;
  await assert.rejects(() => service.call('chat', { id: challenge, text: 'Keep this draft' }), /Offline/);
  assert.deepEqual({ ...service.snapshot(), seq: 0 }, { ...before, seq: 0 }, 'A failed generation must not erase or partially commit a conversation');
  assert.equal(open().snapshot().sessions.at(-1).messages.length, 4);
  fail = false;
  const [image] = await storeUploads(join(directory, 'notes'), [{ name: 'pixel.png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64') }]);
  await service.call('pin', { id: board, pin: { id: 'image', kind: 'image', title: 'Pixel', body: '', url: image.url, x: 0, y: 0 } });
  await service.call('chat', { id: board, text: 'What is visible in this image?' });
  assert(calls.at(-1).images[0].url.startsWith('data:image/png;base64,'), 'Pinned image pixels must reach the model');
  let release;
  const delay = new Promise(resolve => { release = resolve; });
  service = createBrainstorm({ directory, notes, context, now: () => timestamp, generate: async value => { if (value.outputSchema?.properties.idea) await delay; return generate(value); } });
  const background = service.call('prepare', { mode: 'present' });
  assert.deepEqual(service.snapshot().preparing, ['present']);
  await service.call('create', { mode: 'story', title: 'Continue while ideas load' });
  release(); await background;
  assert.equal(open().snapshot().sessions.at(-1).title, 'Continue while ideas load', 'Background preparation must merge without losing concurrent work');
  assert.equal(open().snapshot().prepared.present.generatedAt, timestamp);
  fail = true;
  await assert.rejects(() => service.call('prepare', { mode: 'thoughts' }), /Offline/);
  assert.equal(service.snapshot().failures.thoughts, 'Offline');
  assert(service.snapshot().prepared.thoughts, 'A failed refresh keeps the previous module');
  fail = false;
  console.log('BRAINSTORM_OK: prepared modules, instant open, branches, custom directions, notes conflicts, board links, Unicode, check-ins, feedback, recovery');
} finally { notes.close(); }
