import { Type } from 'typebox';

const text = max => Type.String({ minLength: 1, maxLength: max });
const object = properties => Type.Object(properties, { additionalProperties: false });
const list = (schema, minItems, maxItems) => Type.Array(schema, { minItems, maxItems });
const sources = Type.Array(text(300), { maxItems: 8 });
const item = object({ title: text(200), body: text(3000), sources });
const branch = object({ title: text(200), body: text(2000) });
const index = Type.Integer({ minimum: 0, maximum: 5 });

// Each module is prepared in the background, so opening it never waits for a model turn.
export const prepareSpecs = {
  present: {
    schema: object({ idea: item, origin: text(1200), whyNow: text(800), opening: text(4000) }),
    task: 'Choose one timely reminder or idea worth returning to now. Explain in origin where it came from in the supplied history or notes, and in whyNow why it matters at this moment. Write opening as your first message when the owner chooses to develop it: two or three short paragraphs and one question.',
  },
  paths: {
    schema: object({ seeds: list(object({ title: text(200), body: text(2000), sources, branches: list(branch, 5, 5) }), 3, 3) }),
    task: 'Return three distinct ideas that could branch into stories, projects or decisions. For each, write five plausible directions it could take, each with a short title and a concrete narrative possibility.',
  },
  story: {
    schema: object({
      chapters: list(object({ title: text(200), when: text(80), body: text(2000), sources }), 3, 5),
      patterns: list(object({ title: text(200), body: text(1500) }), 2, 3),
      continuations: list(object({ title: text(200), body: text(1500), question: text(600) }), 3, 3),
    }),
    task: 'Reconstruct the owner’s story as three to five chapters in time order, using only supplied evidence. Label each chapter with a short period taken from the evidence; use a relative label when dates are missing. Add two or three patterns they might not yet see, framed tentatively, and three possible continuations, each ending with one reflective question.',
  },
  challenges: {
    schema: object({
      wins: list(item, 0, 3), struggles: list(item, 0, 3),
      suggestions: list(object({ title: text(200), why: text(800), firstStep: text(600), opening: text(3000) }), 3, 3),
    }),
    task: 'Collect up to three past wins and up to three past difficulties found in the evidence; return empty lists when none exist. Suggest three manageable challenges for the coming days, each with why it fits, one small first step for today, and an opening message that invites the owner to adjust it.',
  },
  board: {
    schema: object({
      title: text(200), question: text(600),
      pins: list(object({ title: text(200), body: text(1500), sources }), 3, 6),
      links: list(object({ from: index, to: index, label: text(300) }), 1, 8),
    }),
    task: 'Build a starter idea board from three to six pieces of the supplied material that connect in a meaningful way. Links reference pins by zero-based position and describe the connection. Add one open question the board helps investigate.',
  },
  thoughts: {
    schema: object({ thoughts: list(object({ title: text(200), body: text(2000), sources, opening: text(3000) }), 3, 3) }),
    task: 'Offer three distinct free thoughts to sit with, shaped by the explicit feedback on earlier thoughts. Write an opening message for each, used when the owner chooses to talk about it.',
  },
};

const clip = (value, length) => Array.from(String(value || '')).slice(0, length).join('').trim();

export function sourceLabels(evidence) {
  const labels = {};
  for (const note of evidence.notes || []) labels[note.id] = { kind: 'note', label: clip(note.title, 80) || 'Note' };
  for (const message of evidence.history || []) labels[message.id] = { kind: 'chat', label: clip(message.content, 80) || 'Conversation', at: message.timestamp };
  for (const session of evidence.previousSessions || []) labels[session.id] = { kind: 'brainstorm', label: clip(session.title, 80) };
  for (const observation of evidence.observations || []) labels[observation.id] = { kind: 'memory', label: clip(observation.observation, 80) || 'Observation' };
  for (const fact of Object.values(evidence.memory?.documents || {}).flat()) labels[fact.id] = { kind: 'memory', label: clip(fact.fact, 80) || 'Memory' };
  for (const feedback of evidence.feedback || []) labels[feedback.id] = { kind: 'feedback', label: clip(feedback.title, 80) };
  return labels;
}

// Unknown citations are dropped instead of failing the whole module.
export function keepKnownSources(value, labels) {
  if (Array.isArray(value)) return value.map(entry => keepKnownSources(entry, labels));
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, keepKnownSources(entry, labels)]));
  if (Array.isArray(value.sources)) result.sources = value.sources.filter(id => Object.hasOwn(labels, id));
  if (Array.isArray(value.links) && Array.isArray(value.pins)) result.links = value.links.filter(link => link.from !== link.to && link.from < value.pins.length && link.to < value.pins.length);
  return result;
}

const message = (id, content, timestamp) => ({ id, role: 'assistant', content, timestamp });

export function sessionFromPrepared(mode, data, position, { id, now }) {
  const base = { id: id(), mode, title: '', seed: '', messages: [], nodes: [], selectedId: '', pins: [], edges: [], updatedAt: now, reminder: false, nextCheckIn: 0, prepared: true };
  if (mode === 'present') return { ...base, title: data.idea.title, seed: data.idea.body, messages: [message(id(), data.opening, now)] };
  if (mode === 'paths') {
    const seed = data.seeds[position], root = id();
    return { ...base, title: seed.title, seed: seed.body, selectedId: root, nodes: [{ id: root, parentId: '', title: seed.title, body: seed.body }, ...seed.branches.map(branch => ({ ...branch, id: id(), parentId: root, suggested: true }))] };
  }
  if (mode === 'story') {
    const next = data.continuations[position];
    return { ...base, title: next.title, seed: next.body, messages: [message(id(), next.question, now)] };
  }
  if (mode === 'challenges') {
    const challenge = data.suggestions[position];
    return { ...base, title: challenge.title, seed: `${challenge.why}\n\n${challenge.firstStep}`, messages: [message(id(), challenge.opening, now)], reminder: true, nextCheckIn: now + 86400000 };
  }
  if (mode === 'thoughts') {
    const thought = data.thoughts[position];
    return { ...base, title: thought.title, seed: thought.body, messages: [message(id(), thought.opening, now)] };
  }
  if (mode === 'board') {
    // An ellipse keeps every link visible and leaves the centre for the board question.
    const pins = data.pins.map((pin, at) => {
      const angle = at / data.pins.length * Math.PI * 2 - Math.PI / 2;
      return { id: id(), kind: 'text', title: pin.title, body: pin.body, x: Math.round(Math.max(20, 450 + Math.cos(angle) * 330)), y: Math.round(Math.max(20, 220 + Math.sin(angle) * 170)) };
    });
    return { ...base, title: data.title, seed: data.question, pins, edges: data.links.map(link => ({ id: id(), from: pins[link.from].id, to: pins[link.to].id, label: link.label })) };
  }
  throw new Error('Unknown Brainstorm module.');
}

export function preparedChoices(mode, data) {
  return { present: 1, paths: data.seeds?.length, story: data.continuations?.length, challenges: data.suggestions?.length, thoughts: data.thoughts?.length, board: 1 }[mode] || 0;
}
