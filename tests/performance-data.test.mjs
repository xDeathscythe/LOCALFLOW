import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { queryRows } from '../host/notes/database-engine.mjs';
import { createNotesService } from '../host/notes-service.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createConversationStore } from '../host/conversation-store.mjs';

const root = await mkdtemp(join(tmpdir(), 'localflow-performance-'));
const changes = [], notes = createNotesService(root, change => changes.push(change));
try {
  const original = await notes.create({ label: '日本語 العربية', content: 'Keep me' });
  const writes = await Promise.allSettled([
    notes.save({ ...original, content: 'Winner' }),
    notes.save({ ...original, content: 'Must conflict' }),
  ]);
  assert.equal(writes[0].status, 'fulfilled'); assert.equal(writes[1].status, 'rejected');
  assert.match(writes[1].reason.message, /changed elsewhere/);
  assert.equal((await notes.read(original.id)).content, 'Winner');
  await notes.close();
  const reopened=createNotesService(root,()=>{});assert.equal((await reopened.read(original.id)).content,'Winner');await reopened.close();
  assert(changes.some(change => change.tree === false && change.ids.includes(original.id)));
  await assert.rejects(notes.list(), /closed/);
} finally { await notes.close(); }

const database = new DatabaseSync(join(root, 'conversation-test.sqlite'));
const writer = createConversationStore(database, root, error => { throw error; }, 10000);
const file = join(root, 'conversation.json');
const conversation = { id: 'test', transcript: Array.from({length: 10000}, (_, id) => ({id: String(id), content:'中文 العربية', work:{diff:'+keep'}})) };
writer.write(file, conversation); writer.flush();
const beforeChanges = database.prepare('SELECT total_changes() AS count').get().count;
conversation.transcript[42].work.diff = '+updated';
conversation.transcript.push({id: 'new', content:'日本語', work:{diff:'+new'}});
writer.write(file, conversation, [conversation.transcript[42]]); writer.flush();
assert.equal(database.prepare('SELECT total_changes() AS count').get().count - beforeChanges, 3, 'one metadata, one new and one edited message, not 10001 messages');
const page=writer.read(file);assert.equal(page.messageOffset,9901);assert.deepEqual(page.transcript,conversation.transcript.slice(-100));
assert.deepEqual(writer.range(file,0,100),conversation.transcript.slice(0,100));
database.exec("CREATE TRIGGER block_write BEFORE UPDATE ON conversations BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
conversation.transcript[4].work.diff = '+retry'; writer.write(file, conversation, [conversation.transcript[4]]);
assert.throws(() => writer.flush(), /fixture failure/); assert.equal(writer.read(file).transcript[4].work.diff, '+retry');
database.exec('DROP TRIGGER block_write'); writer.flush();
assert.equal(writer.range(file,4,1)[0].work.diff, '+retry');
database.close();

function benchmark(label, run) {
  run(); const times = [];
  for (let i = 0; i < 5; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ label, medianMs: +times[2].toFixed(2), maxMs: +times[4].toFixed(2) }));
}
for (const count of [1000, 10000, 50000]) {
  const db = { id: 'bench', properties: [{ id: 'title', name: 'Name', type: 'title' }, ...Array.from({ length: 9 }, (_, i) => ({ id: 'n'+i, name: 'Number'+i, type: 'number' }))], rows: Array.from({ length: count }, (_, i) => ({ id: 'r'+i, values: { title: 'Item '+i, ...Object.fromEntries(Array.from({ length: 9 }, (_, j) => ['n'+j, i+j])) } })) };
  const run = () => queryRows(db, { sorts: [{ property: 'n0', direction: 'desc' }] }, []);
  assert.equal(run()[0].values.n0, count - 1); benchmark(`queryRows ${count} x 10`, run);
}
for (const count of [1000, 5000]) {
  const target = { id: 'target', properties: [{ id: 'amount', name: 'Amount', type: 'number' }], rows: Array.from({ length: count }, (_, i) => ({ id: 't'+i, pageId: 'p'+i, values: { amount: i } })) };
  const db = { id: 'bench', properties: [{ id: 'rel', name: 'Relation', type: 'relation', target: 'target' }, { id: 'roll', name: 'Rollup', type: 'rollup', relation: 'rel', targetProperty: 'amount', aggregation: 'sum' }], rows: Array.from({ length: count }, (_, i) => ({ id: 'r'+i, values: { rel: ['t'+i, 'p'+i] } })) };
  const run = () => queryRows(db, {}, [target]); const result = run();
  assert.equal(result.at(-1).values.roll, count - 1); assert.deepEqual(result.at(-1).errors, {});
  benchmark(`rollup ${count} x ${count}`, run);
  db.properties[1].aggregation = 'show'; db.rows[0].values.rel = ['p2', 't0', 'p0', 'missing'];
  assert.deepEqual(queryRows(db, {}, [target])[0].values.roll, [0, 2], 'Preserve target order and deduplicate aliases');
}
console.log('PERFORMANCE_DATA_OK: serialized conflicting saves, graceful worker close, incremental conversation writes, failed-write retry, rollup aliases and ordering');
