import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { readJsonFile, writeJsonFile } from './niwa/host/niwa-store.mjs';
import { modes, instruction, pageContent } from './brainstorm-content.mjs';
import { readFileSync, statSync } from 'node:fs';
import assetPaths from './notes/asset-path.cjs';

const text = (max = 16000) => Type.String({ minLength: 1, maxLength: max });
const idea = Type.Object({ title: text(200), body: text(5000), sources: Type.Array(text(300), { maxItems: 8 }) }, { additionalProperties: false });
const homeSchema = Type.Object({ present: idea, ideas: Type.Array(idea, { minItems: 3, maxItems: 3 }), thoughts: Type.Array(idea, { minItems: 3, maxItems: 3 }) }, { additionalProperties: false });
const branchesSchema = Type.Object({ branches: Type.Array(Type.Object({ title: text(200), body: text(4000) }, { additionalProperties: false }), { minItems: 5, maxItems: 5 }) }, { additionalProperties: false });
const pinSchema = Type.Object({ id: text(100), kind: Type.Union(['text', 'note', 'image', 'link', 'message'].map(Type.Literal)), title: text(200), body: Type.String({ maxLength: 30000 }), url: Type.Optional(Type.String({ maxLength: 4000 })), x: Type.Number({ minimum: 0, maximum: 5000 }), y: Type.Number({ minimum: 0, maximum: 5000 }) });
const check = (schema, value) => { if (!Value.Check(schema, value)) throw new Error('Invalid Brainstorm data. Please retry.'); return value; };
const validUrl = url => { if (!url) return true; try { return ['https:', 'http:', 'localflow-asset:'].includes(new URL(url).protocol); } catch { return false; } };

export function createBrainstorm({ directory, notes, context, generate, now = Date.now }) {
  const file = join(directory, 'niwa', 'brainstorm.json');
  let state = readJsonFile(file, { version: 1, revision: 0, home: null, sessions: [], feedback: [] });
  let locked = false;
  let homePending;
  const save = next => { next.revision++; writeJsonFile(file, next); state = next; };
  const sources = async () => {
    const tree = await notes.list(), pages = [];
    const walk = items => items.forEach(item => item.kind === 'note' ? pages.push(item) : walk(item.children || []));
    walk(tree.items);
    const recent = pages.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 16);
    const content = await Promise.all(recent.map(async item => { const page = await notes.read(item.id); return { id: page.id, title: page.label, content: page.content.slice(0, 1800) }; }));
    return { ...(await context()), notes: content, previousSessions: state.sessions.slice(-12).map(s => ({ id: s.id, mode: s.mode, title: s.title, messages: s.messages.slice(-6) })), feedback: state.feedback.slice(-40) };
  };
  const ask = async (mode, task, source, schema) => {
    let input = JSON.stringify(source);
    if (input.length > 95000) input = JSON.stringify({ message: source.message, sessionExcerpt: JSON.stringify(source.session || {}).slice(-26000), contextExcerpt: JSON.stringify(source.context || source).slice(0, 16000), truncated: true });
    const images = [];
    for (const pin of (source.session?.pins || []).filter(p => p.kind === 'image').slice(-6)) {
      if (!pin.url?.startsWith('localflow-asset:')) continue;
      const path = assetPaths.resolveAsset(join(directory, 'notes'), pin.url);
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extname(path).toLowerCase()];
      if (mime && statSync(path).size <= 10000000) images.push({ title: pin.title, url: `data:${mime};base64,${readFileSync(path).toString('base64')}` });
    }
    const result = await generate({ skill: 'ask', isolated: true, text: input, images, prompt: instruction(mode, task + ' If context is truncated, treat it as partial evidence. Only attached images are visible; do not claim to inspect other image contents or linked web pages.'), ...(schema ? { outputSchema: schema } : {}) });
    return schema ? check(schema, JSON.parse(result)) : result;
  };
  const snapshot = () => structuredClone(state);
  return {
    snapshot,
    async call(action, value = {}) {
      if (action === 'load') return snapshot();
      if (action === 'home') {
        // Background suggestions must not block typing, pinning or opening a page.
        if (!homePending) homePending = (async () => {
          const evidence = await sources();
          const home = await ask('present', 'Return one timely reminder or idea for Present, three ideas for Paths and three distinct free thoughts. Ground suggestions in available history and note IDs listed in sources. If history is empty, offer clearly framed starting points without claiming past events. Each sources array contains only supplied IDs, or is empty.', evidence, homeSchema);
          const ids = new Set([...evidence.notes, ...(evidence.history || []), ...(evidence.observations || []), ...(evidence.previousSessions || []), ...(evidence.feedback || []), ...Object.values(evidence.memory?.documents || {}).flat()].map(item => item.id));
          if ([home.present, ...home.ideas, ...home.thoughts].some(item => item.sources.some(id => !ids.has(id)))) throw new Error('Niwa cited a source that is not in the supplied history. Please refresh ideas.');
          const next = structuredClone(state); next.home = { ...home, generatedAt: now() }; save(next); return snapshot();
        })().finally(() => { homePending = null; });
        return homePending;
      }
      if (locked) throw new Error('Niwa is finishing another Brainstorm action. Try again shortly.');
      locked = true;
      try {
        const next = structuredClone(state);
        if (action === 'create') {
          check(Type.Object({ mode: Type.Union(modes.map(Type.Literal)), title: text(200), seed: Type.Optional(Type.String({ maxLength: 16000 })) }), value);
          next.sessions.push({ id: randomUUID(), mode: value.mode, title: value.title, seed: value.seed || '', messages: [], nodes: [], selectedId: '', pins: [], edges: [], updatedAt: now(), reminder: value.mode === 'challenges', nextCheckIn: value.mode === 'challenges' ? now() + 86400000 : 0 });
        } else if (action === 'feedback') {
          check(Type.Object({ id: text(100), title: text(200), body: text(5000), rating: Type.Union([Type.Literal(-1), Type.Literal(1)]) }), value);
          next.feedback = [...next.feedback.filter(f => f.id !== value.id), { ...value, at: now() }].slice(-200);
        } else {
          const session = next.sessions.find(s => s.id === value.id);
          if (!session) throw new Error('Brainstorm page not found.');
          if (action === 'chat') {
            check(text(), value.text);
            const content = await ask(session.mode, 'Respond to the latest user message. Use the supplied session as continuity, including previous check-ins. Return Markdown.', { context: await sources(), session, message: value.text });
            session.messages.push({ id: randomUUID(), role: 'user', content: value.text, timestamp: now() }, { id: randomUUID(), role: 'assistant', content, timestamp: now() });
            if (session.mode === 'challenges' && session.reminder) session.nextCheckIn = now() + 86400000;
          } else if (action === 'branch') {
            if (session.mode !== 'paths') throw new Error('Open a Paths page first.');
            if (value.parentId && !session.nodes.some(n => n.id === value.parentId)) throw new Error('Path not found.');
            check(text(200), value.title); check(text(16000), value.body);
            const node = { id: randomUUID(), parentId: value.parentId || '', title: value.title, body: value.body };
            session.nodes.push(node); session.selectedId = node.id;
          } else if (action === 'expand') {
            const parent = session.nodes.find(n => n.id === value.nodeId);
            if (session.mode !== 'paths' || !parent) throw new Error('Select a path first.');
            if (session.nodes.some(n => n.parentId === parent.id && n.suggested)) throw new Error('This path already has suggested directions.');
            const result = await ask('paths', 'Return exactly five distinct, plausible directions branching from the selected node, each with a short title and a concrete narrative possibility. Do not include the blank user-authored direction; the interface supplies it.', { context: await sources(), session, selectedNode: parent }, branchesSchema);
            session.nodes.push(...result.branches.map(b => ({ ...b, id: randomUUID(), parentId: parent.id, suggested: true }))); session.selectedId = parent.id;
          } else if (action === 'select') {
            if (!session.nodes.some(n => n.id === value.nodeId)) throw new Error('Path not found.');
            session.selectedId = value.nodeId;
          } else if (action === 'write') {
            const node = session.nodes.find(n => n.id === value.nodeId);
            if (!node) throw new Error('Path not found.');
            check(text(), value.body); node.body = value.body;
          } else if (action === 'pin') {
            check(pinSchema, value.pin);
            if (!validUrl(value.pin.url)) throw new Error('Use a web link or a Notes image.');
            const index = session.pins.findIndex(p => p.id === value.pin.id);
            if (index < 0) session.pins.push(value.pin); else session.pins[index] = value.pin;
          } else if (action === 'unpin') {
            session.pins = session.pins.filter(p => p.id !== value.pinId);
            session.edges = session.edges.filter(e => e.from !== value.pinId && e.to !== value.pinId);
          } else if (action === 'connect') {
            check(text(1000), value.label);
            if (value.from === value.to || ![value.from, value.to].every(id => session.pins.some(p => p.id === id))) throw new Error('Choose two different pins.');
            session.edges.push({ id: randomUUID(), from: value.from, to: value.to, label: value.label });
          } else if (action === 'disconnect') {
            session.edges = session.edges.filter(e => e.id !== value.edgeId);
          } else if (action === 'reminder') {
            if (session.mode !== 'challenges' || typeof value.enabled !== 'boolean') throw new Error('Invalid challenge reminder.');
            session.reminder = value.enabled; session.nextCheckIn = now() + 86400000;
          } else if (action === 'save-note') {
            const content = pageContent(session);
            if (session.noteId) {
              const previous = await notes.read(session.noteId);
              if (previous.revision !== session.noteRevision) throw new Error('This Notes page was edited separately. Save a new copy to preserve those edits.');
              const saved = await notes.save({ ...previous, content, document: undefined, html: undefined }); session.noteRevision = saved.revision;
            } else {
              const note = await notes.create({ label: session.title, content }); session.noteId = note.id; session.noteRevision = note.revision;
            }
          } else if (action === 'copy-note') {
            const note = await notes.create({ label: session.title, content: pageContent(session) }); session.noteId = note.id; session.noteRevision = note.revision;
          } else throw new Error('Unknown Brainstorm action.');
          session.updatedAt = now();
        }
        // The background home request may have completed during this turn.
        next.home = state.home; next.revision = state.revision;
        save(next);
        return snapshot();
      } finally { locked = false; }
    },
  };
}
