import { extname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { readJsonFile, writeJsonFile } from './niwa/host/niwa-store.mjs';
import { modes, instruction, pageContent } from './brainstorm-content.mjs';
import { prepareSpecs, sourceLabels, keepKnownSources, sessionFromPrepared, preparedChoices } from './brainstorm-prepare.mjs';
import { readFileSync, statSync } from 'node:fs';
import assetPaths from './notes/asset-path.cjs';

const text = (max = 16000) => Type.String({ minLength: 1, maxLength: max });
const branchesSchema = Type.Object({ branches: Type.Array(Type.Object({ title: text(200), body: text(4000) }, { additionalProperties: false }), { minItems: 5, maxItems: 5 }) }, { additionalProperties: false });
const pinSchema = Type.Object({ id: text(100), kind: Type.Union(['text', 'note', 'image', 'link', 'message'].map(Type.Literal)), title: text(200), body: Type.String({ maxLength: 30000 }), url: Type.Optional(Type.String({ maxLength: 4000 })), x: Type.Number({ minimum: 0, maximum: 5000 }), y: Type.Number({ minimum: 0, maximum: 5000 }) });
const check = (schema, value) => { if (!Value.Check(schema, value)) throw new Error('Invalid Brainstorm data. Please retry.'); return value; };
const validUrl = url => { if (!url) return true; try { return ['https:', 'http:', 'localflow-asset:'].includes(new URL(url).protocol); } catch { return false; } };
const HOUR = 3600000, RETRY = 10 * 60000;
const citedIds = value => Array.isArray(value) ? value.flatMap(citedIds) : value && typeof value === 'object' ? [...(Array.isArray(value.sources) ? value.sources : []), ...Object.values(value).flatMap(citedIds)] : [];

export function createBrainstorm({ directory, notes, context, generate, notify = () => {}, now = Date.now }) {
  const file = join(directory, 'niwa', 'brainstorm.json');
  const stored = readJsonFile(file, {});
  // Version 1 kept a single "home" suggestion set; prepared modules replace it.
  let state = { version: 2, revision: stored.revision || 0, prepared: stored.prepared || {}, sessions: stored.sessions || [], feedback: stored.feedback || [] };
  const preparing = new Set(), answering = new Set(), growing = new Set(), failures = {}, attempts = {};
  let queue = Promise.resolve(), cycle, seq = 0;
  const epoch = randomUUID();
  // seq orders every snapshot, including in-flight changes that do not bump the stored revision.
  const snapshot = () => ({ ...structuredClone(state), epoch, seq: ++seq, preparing: [...preparing], answering: [...answering], growing: [...growing], failures: { ...failures } });
  const publish = () => notify(snapshot());
  // Mutations are serialised; model turns run outside the queue so pins, edits and navigation never wait for them.
  const commit = work => {
    const run = queue.then(async () => {
      const next = structuredClone(state);
      const extra = await work(next);
      next.revision = state.revision + 1; writeJsonFile(file, next); state = next; publish();
      return { ...snapshot(), ...extra };
    });
    queue = run.catch(() => {});
    return run;
  };
  const findSession = (from, id) => { const session = from.sessions.find(s => s.id === id); if (!session) throw new Error('Brainstorm page not found.'); return session; };
  const sources = async () => {
    const tree = await notes.list(), pages = [];
    const walk = items => items.forEach(item => item.kind === 'note' ? pages.push(item) : walk(item.children || []));
    walk(tree.items);
    const recent = pages.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 16);
    const content = await Promise.all(recent.map(async item => { const page = await notes.read(item.id); return { id: page.id, title: page.label, content: page.content.slice(0, 1800) }; }));
    const evidence = { ...(await context()), notes: content, previousSessions: state.sessions.slice(-12).map(s => ({ id: s.id, mode: s.mode, title: s.title, messages: s.messages.slice(-6) })), feedback: state.feedback.slice(-40) };
    const stamp = createHash('sha256').update(JSON.stringify([recent.map(p => [p.id, p.updatedAt]), evidence.history?.at(-1)?.id, state.sessions.length, state.feedback.length])).digest('base64url');
    return { evidence, stamp };
  };
  const ask = async (mode, task, source, schema, timeoutMs) => {
    let input = JSON.stringify(source);
    if (input.length > 95000) input = JSON.stringify({ message: source.message, sessionExcerpt: JSON.stringify(source.session || {}).slice(-26000), contextExcerpt: JSON.stringify(source.context || source).slice(0, 16000), truncated: true });
    const images = [];
    for (const pin of (source.session?.pins || []).filter(p => p.kind === 'image').slice(-6)) {
      if (!pin.url?.startsWith('localflow-asset:')) continue;
      const path = assetPaths.resolveAsset(join(directory, 'notes'), pin.url);
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extname(path).toLowerCase()];
      try { if (mime && statSync(path).size <= 10000000) images.push({ title: pin.title, url: `data:${mime};base64,${readFileSync(path).toString('base64')}` }); } catch {} // A deleted image must not block the conversation.
    }
    const result = await generate({ skill: 'ask', isolated: true, text: input, images, prompt: instruction(mode, task + ' If context is truncated, treat it as partial evidence. Only attached images are visible; do not claim to inspect other image contents or linked web pages.'), ...(schema ? { outputSchema: schema } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
    if (!schema) return result;
    let parsed; try { parsed = JSON.parse(result); } catch { throw new Error('Invalid Brainstorm data. Please retry.'); }
    return check(schema, parsed);
  };
  const stale = (mode, stamp) => {
    const entry = state.prepared[mode];
    if (!entry) return true;
    const age = now() - entry.generatedAt;
    return age > 24 * HOUR || (entry.stamp !== stamp && age > 3 * HOUR);
  };
  async function prepare(mode, gathered) {
    if (preparing.has(mode)) return snapshot();
    preparing.add(mode); delete failures[mode]; publish();
    try {
      const { evidence, stamp } = gathered || await sources();
      const labels = sourceLabels(evidence), spec = prepareSpecs[mode];
      const data = keepKnownSources(await ask(mode, `${spec.task} Ground everything in the supplied history and notes and cite their IDs in sources. If history is sparse, offer clearly framed starting points without claiming past events. Write in the language used most in the supplied material.`, evidence, spec.schema, 240000), labels);
      return await commit(next => { next.prepared[mode] = { generatedAt: now(), stamp, data, sources: Object.fromEntries(citedIds(data).map(id => [id, labels[id]])) }; });
    } catch (error) { failures[mode] = error.message; attempts[mode] = now(); throw error; }
    finally { preparing.delete(mode); publish(); }
  }
  // Runs one module at a time in the background; a failed module waits before it is retried.
  const prepareAll = () => cycle ||= (async () => {
    const gathered = await sources();
    for (const mode of modes) {
      if (!stale(mode, gathered.stamp) || now() - (attempts[mode] || 0) < RETRY) continue;
      // One failure usually means the model connection is unavailable; the next cycle tries again.
      try { await prepare(mode, gathered); } catch { break; }
    }
  })().catch(() => {}).finally(() => { cycle = null; });

  async function answer(sessionId, message) {
    if (answering.has(sessionId)) throw new Error('Niwa is still answering on this page.');
    answering.add(sessionId); publish();
    try {
      const { evidence } = await sources();
      const content = await ask(findSession(state, sessionId).mode, 'Respond to the latest user message. Use the supplied session as continuity, including previous check-ins. Return Markdown.', { context: evidence, session: findSession(state, sessionId), message });
      return await commit(next => {
        const session = findSession(next, sessionId);
        session.messages.push({ id: randomUUID(), role: 'user', content: message, timestamp: now() }, { id: randomUUID(), role: 'assistant', content, timestamp: now() });
        if (session.mode === 'challenges' && session.reminder) session.nextCheckIn = now() + 86400000;
        session.updatedAt = now();
      });
    } finally { answering.delete(sessionId); publish(); }
  }
  async function expand(sessionId, nodeId) {
    const session = findSession(state, sessionId), parent = session.nodes.find(n => n.id === nodeId);
    if (session.mode !== 'paths' || !parent) throw new Error('Select a path first.');
    if (session.nodes.some(n => n.parentId === nodeId && n.suggested)) throw new Error('This path already has suggested directions.');
    if (growing.has(nodeId)) return snapshot();
    growing.add(nodeId); publish();
    try {
      const { evidence } = await sources();
      const result = await ask('paths', 'Return exactly five distinct, plausible directions branching from the selected node, each with a short title and a concrete narrative possibility. Do not include the blank user-authored direction; the interface supplies it.', { context: evidence, session, selectedNode: parent }, branchesSchema);
      return await commit(next => {
        const target = findSession(next, sessionId);
        if (target.nodes.some(n => n.id === nodeId) && !target.nodes.some(n => n.parentId === nodeId && n.suggested)) target.nodes.push(...result.branches.map(b => ({ ...b, id: randomUUID(), parentId: nodeId, suggested: true })));
        target.updatedAt = now();
      });
    } finally { growing.delete(nodeId); publish(); }
  }
  const edit = (id, work, touch = true) => commit(async next => { const session = findSession(next, id); await work(session, next); if (touch) session.updatedAt = now(); });

  return {
    snapshot, prepareAll,
    async call(action, value = {}) {
      if (action === 'load') { void prepareAll(); return snapshot(); }
      if (action === 'prepare') { check(Type.Union(modes.map(Type.Literal)), value.mode); return prepare(value.mode); }
      if (action === 'chat') { check(text(), value.text); return answer(value.id, value.text); }
      if (action === 'expand') return expand(value.id, value.nodeId);
      if (action === 'open') {
        check(Type.Object({ mode: Type.Union(modes.map(Type.Literal)), index: Type.Integer({ minimum: 0, maximum: 5 }), generatedAt: Type.Number() }), value);
        return commit(next => {
          const entry = next.prepared[value.mode];
          if (!entry) throw new Error('Niwa is still preparing this module.');
          if (entry.generatedAt !== value.generatedAt) throw new Error('Niwa just refreshed these ideas. Take a look at the new ones.');
          if (value.index >= preparedChoices(value.mode, entry.data)) throw new Error('This suggestion is no longer available.');
          const origin = `${value.mode}:${entry.generatedAt}:${value.index}`;
          const existing = next.sessions.find(s => s.origin === origin);
          if (existing) { existing.updatedAt = now(); return { openedId: existing.id }; }
          const session = { ...sessionFromPrepared(value.mode, entry.data, value.index, { id: randomUUID, now: now() }), origin };
          next.sessions.push(session);
          return { openedId: session.id };
        });
      }
      if (action === 'create') {
        check(Type.Object({ mode: Type.Union(modes.map(Type.Literal)), title: text(200), seed: Type.Optional(Type.String({ maxLength: 16000 })) }), value);
        return commit(next => {
          const id = randomUUID();
          next.sessions.push({ id, mode: value.mode, title: value.title, seed: value.seed || '', messages: [], nodes: [], selectedId: '', pins: [], edges: [], updatedAt: now(), reminder: value.mode === 'challenges', nextCheckIn: value.mode === 'challenges' ? now() + 86400000 : 0 });
          return { openedId: id };
        });
      }
      if (action === 'feedback') {
        check(Type.Object({ id: text(100), title: text(200), body: text(5000), rating: Type.Union([Type.Literal(-1), Type.Literal(1)]) }), value);
        return commit(next => { next.feedback = [...next.feedback.filter(f => f.id !== value.id), { ...value, at: now() }].slice(-200); });
      }
      if (action === 'branch') return edit(value.id, session => {
        if (session.mode !== 'paths') throw new Error('Open a Paths page first.');
        if (value.parentId && !session.nodes.some(n => n.id === value.parentId)) throw new Error('Path not found.');
        check(text(200), value.title); check(text(16000), value.body);
        const node = { id: randomUUID(), parentId: value.parentId || '', title: value.title, body: value.body };
        session.nodes.push(node); session.selectedId = node.id;
      });
      if (action === 'select') return edit(value.id, session => { if (!session.nodes.some(n => n.id === value.nodeId)) throw new Error('Path not found.'); session.selectedId = value.nodeId; });
      if (action === 'write') return edit(value.id, session => { const node = session.nodes.find(n => n.id === value.nodeId); if (!node) throw new Error('Path not found.'); check(text(), value.body); node.body = value.body; });
      if (action === 'pin') return edit(value.id, session => {
        check(pinSchema, value.pin);
        if (!validUrl(value.pin.url)) throw new Error('Use a web link or a Notes image.');
        const index = session.pins.findIndex(p => p.id === value.pin.id);
        if (index < 0) session.pins.push(value.pin); else session.pins[index] = value.pin;
      });
      if (action === 'unpin') return edit(value.id, session => { session.pins = session.pins.filter(p => p.id !== value.pinId); session.edges = session.edges.filter(e => e.from !== value.pinId && e.to !== value.pinId); });
      if (action === 'connect') return edit(value.id, session => {
        check(text(1000), value.label);
        if (value.from === value.to || ![value.from, value.to].every(id => session.pins.some(p => p.id === id))) throw new Error('Choose two different pins.');
        session.edges.push({ id: randomUUID(), from: value.from, to: value.to, label: value.label });
      });
      if (action === 'disconnect') return edit(value.id, session => { session.edges = session.edges.filter(e => e.id !== value.edgeId); });
      if (action === 'reminder') return edit(value.id, session => {
        if (session.mode !== 'challenges' || typeof value.enabled !== 'boolean') throw new Error('Invalid challenge reminder.');
        session.reminder = value.enabled; session.nextCheckIn = now() + 86400000;
      });
      if (action === 'save-note') return edit(value.id, async session => {
        const content = pageContent(session);
        if (session.noteId) {
          const previous = await notes.read(session.noteId);
          if (previous.revision !== session.noteRevision) throw new Error('This Notes page was edited separately. Save a new copy to preserve those edits.');
          const saved = await notes.save({ ...previous, content, document: undefined, html: undefined }); session.noteRevision = saved.revision;
        } else {
          const note = await notes.create({ label: session.title, content }); session.noteId = note.id; session.noteRevision = note.revision;
        }
        session.savedAt = now();
      }, false);
      if (action === 'copy-note') return edit(value.id, async session => { const note = await notes.create({ label: session.title, content: pageContent(session) }); session.noteId = note.id; session.noteRevision = note.revision; session.savedAt = now(); }, false);
      throw new Error('Unknown Brainstorm action.');
    },
  };
}
