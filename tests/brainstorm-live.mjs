// Opt-in integration probe. Uses the signed-in account, with synthetic context and a temporary Notes store.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBrainstorm } from '../host/brainstorm.mjs';
import { createNotesStore } from '../host/notes-store.mjs';
import runtime from '../host/runtime-config.cjs';
import writing from '../host/notes/skills.cjs';
if (!process.argv.includes('--live')) throw new Error('Pass --live to use the connected Codex account.');
const directory = mkdtempSync(join(tmpdir(), 'localflow-brainstorm-live-'));
const profile = join(process.env.APPDATA, 'localflow');
const settings = JSON.parse(readFileSync(join(profile, 'niwa/settings.json'), 'utf8'));
const notes = createNotesStore(directory);
notes.create({ label: 'Novi roman', content: 'Pišem priču o bibliotekarki koja pronalazi pismo bez potpisa. Želim da istražim nekoliko mogućih smerova.' });
const service = createBrainstorm({ directory, notes, context: async () => ({ history: [{ id: 'test-chat', role: 'user', content: 'Voleo bih da priča bude tiha i realistična, bez fantastike.' }] }),
  generate: value => writing.runNoteSkill({ directory: profile, binary: runtime.resolveNiwaCodexBinary, settings }, value),
});
try {
  let state = await service.call('home'); assert.equal(state.home.thoughts.length, 3);
  console.log('LIVE_BRAINSTORM_HOME_OK', state.home.present.title);
  state = await service.call('create', { mode: 'paths', title: state.home.ideas[0].title, seed: state.home.ideas[0].body });
  const id = state.sessions.at(-1).id;
  state = await service.call('branch', { id, title: state.sessions.at(-1).title, body: state.sessions.at(-1).seed });
  state = await service.call('expand', { id, nodeId: state.sessions.at(-1).selectedId });
  assert.equal(state.sessions.at(-1).nodes.length, 6); console.log('LIVE_BRAINSTORM_FIVE_PATHS_OK');
  state = await service.call('chat', { id, text: 'Kako da razvijem ovu priču bez žurbe?' });
  assert(state.sessions.at(-1).messages.at(-1).content.length > 20); console.log('LIVE_BRAINSTORM_CONVERSATION_OK', directory);
} finally { notes.close(); }
