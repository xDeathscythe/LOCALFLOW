import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createConversationStore } from '../host/conversation-store.mjs';
import { createNiwaHistory } from '../host/niwa/host/niwa-history.mjs';
import { createNiwaAgent } from '../host/niwa-agent.mjs';
import codex from '../host/codex-client.cjs';
import { TestClient } from './agent-client-fixture.mjs';

mkdirSync('runtime/conversation-recovery', { recursive: true });
const root = mkdtempSync(resolve('runtime/conversation-recovery/run-'));
const file = join(root, 'conversation.json');
const db = new DatabaseSync(join(root, 'full.sqlite'));
const errors = [];
const writer = createConversationStore(db, root, error => errors.push(error), 1);
const conversation = { id: 'full', transcript: [{ content: '日本語 العربية Srpski' }] };
writer.write(file, conversation); writer.flush();
db.exec(`PRAGMA max_page_count=${db.prepare('PRAGMA page_count').get().page_count}`);
conversation.transcript.push({ content: '界'.repeat(100000) });
writer.write(file, conversation);
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(errors.length, 1);
assert.equal(errors[0].errcode, 13, 'Preserve SQLITE_FULL, not a secondary rollback error');
assert.equal(db.isTransaction, false, 'SQLite already rolled back the failed transaction');
assert.equal(db.prepare('SELECT count(*) AS n FROM conversation_messages').get().n, 1);
assert.equal(writer.read(file).transcript.length, 2, 'Unsaved messages remain pending');
db.exec('PRAGMA max_page_count=1000000');
writer.flush();
assert.deepEqual(writer.read(file), conversation, 'Retry saves the retained transcript');
db.close();
const reopened = new DatabaseSync(join(root, 'full.sqlite'));
assert.deepEqual(createConversationStore(reopened, root, assert.fail).read(file), conversation);
reopened.close();

const history = createNiwaHistory(root);
const fault = new DatabaseSync(join(root, 'history.sqlite'));
const session = { id: 'history', projectId: 'test', transcript: [{ role: 'user', content: '你好 世界', timestamp: 1 }] };
try {
  for (const action of ['ABORT', 'ROLLBACK']) {
    fault.exec(`CREATE TRIGGER fail_history BEFORE INSERT ON messages BEGIN SELECT RAISE(${action}, 'original storage failure'); END`);
    assert.throws(() => history.sync(session), /original storage failure/);
    assert.equal(history.read(session.id).length, 0);
    fault.exec('DROP TRIGGER fail_history');
  }
  history.sync(session);
  assert.equal(history.search({ query: '你好' }).length, 1);
} finally { fault.close(); history.close(); }

const originalClient = codex.CodexClient;
codex.CodexClient = TestClient;
const events = [];
const options = { directory: root, appRoot: resolve('.'), binary: () => '', notify: event => events.push(event), speak: async () => {} };
let agent = createNiwaAgent(options);
const connection = new DatabaseSync(join(root, 'niwa/history.sqlite'));
try {
  await agent.connect();
  connection.exec("CREATE TRIGGER fail_history BEFORE INSERT ON messages BEGIN SELECT RAISE(ROLLBACK, 'original storage failure'); END");
  const message = { id: 'retained', type: 'agentMessage', text: '日本語 العربية Srpski' };
  assert.doesNotThrow(() => TestClient.current.notify('item/completed', { item: message }));
  assert(events.some(event => event.type === 'error' && event.message.includes('original storage failure')));
  assert(events.some(event => event.type === 'message' && event.content === message.text), 'The response still reaches the UI');
  connection.exec('DROP TRIGGER fail_history');
  connection.exec("CREATE TRIGGER fail_transcript BEFORE INSERT ON conversation_messages BEGIN SELECT RAISE(ROLLBACK, 'transcript storage failure'); END");
  for (let index = 0; index < 205; index++) {
    assert.doesNotThrow(() => TestClient.current.notify('item/completed', { item: { id: `pending-${index}`, type: 'agentMessage', text: `Retained ${index}` } }));
  }
  assert(events.some(event => event.type === 'message' && event.id === 'pending-204'), 'Trimming never hides an unsaved response');
  assert.equal(agent.snapshot().messageTotal, 206, 'A failed flush retains the entire unsaved tail');
  connection.exec('DROP TRIGGER fail_transcript');
  await agent.close();
  agent = createNiwaAgent(options);
  assert(agent.snapshot({ before: 1 }).messages.some(item => item.id === message.id), 'Transcript survives reopening and remains available through paging');
  assert.equal(agent.snapshot().messageTotal, 206);
  assert.equal(connection.prepare('SELECT count(*) AS n FROM messages WHERE content=?').get(message.text).n, 1, 'Index catches up after recovery');
} finally { await agent.close(); connection.close(); codex.CodexClient = originalClient; }
console.log('CONVERSATION_RECOVERY_OK: SQLite full, rollback, pending retry, durable reopen, notification survival and index recovery');
