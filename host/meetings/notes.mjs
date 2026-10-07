import { createHash, randomUUID } from 'node:crypto';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

const markdown = new MarkdownManager({ extensions: [StarterKit.configure({ link: { protocols: ['localflow-note'] } }), TaskList, TaskItem] });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== null && !(Array.isArray(item) && !item.length) && !(key === 'target' && item === '_blank') && !(key === 'rel' && item === 'noopener noreferrer nofollow')).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const normalize = value => JSON.stringify(canonical(value));
const escape = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#!|+.()-]/g, '\\$&');
export const meetingActionId = action => createHash('sha256').update(JSON.stringify([action.text, [...new Set(action.evidence)].sort()])).digest('hex');
export const timecode = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const evidence = (ids, noteId) => ids.map(id => `[${escape(id)}](localflow-note://${noteId}#block-meeting-segment-${id})`).join(' ');
const defaultLabels = { overview: 'Summary', topics: 'Topics', keyPoints: 'Key points', decisions: 'Decisions', actions: 'Action items', openQuestions: 'Open questions', nextSteps: 'Next steps', transcript: 'Transcript', microphone: 'Microphone', remote: 'Remote audio', owner: 'Owner', dueDate: 'Due' };

export function meetingMarkdown(session, transcript, summary) {
  const labels = { ...defaultLabels, ...summary?.labels };
  const lines = [`${new Date(session.startedAt).toISOString()} · ${timecode(session.elapsedMs || 0)}`];
  if (session.application) lines.push(escape(session.application));
  if (session.errors?.length) lines.push('', ...session.errors.map(error => `> ${escape(error)}`));
  if (summary) {
    for (const key of ['actions', 'overview', 'topics', 'decisions', 'openQuestions', 'nextSteps']) {
      lines.push('', `## ${escape(labels[key])}`, '');
      if (key === 'topics') {
        for (const topic of summary.topics || []) {
          lines.push(`### ${escape(topic.title)}`, '');
          for (const item of topic.points) lines.push(`- ${escape(item.text)} ${evidence(item.evidence, session.noteId)}`);
          lines.push('');
        }
        continue;
      }
      for (const item of summary[key]) lines.push(`${key === 'actions' ? session.completedActions?.[meetingActionId(item)] ? '- [x]' : '- [ ]' : '-'} ${escape(item.text)}${item.owner ? ` · ${escape(labels.owner)}: ${escape(item.owner)}` : ''}${item.dueDate ? ` · ${escape(labels.dueDate)}: ${escape(item.dueDate)}` : ''} ${evidence(item.evidence, session.noteId)}`);
      if (!summary[key].length) lines.push('—');
    }
  } else if (session.summaryState === 'pending' || session.summaryState === 'running') lines.push('', '> AI summary pending. The transcript is saved locally.');
  lines.push('', `## ${escape(labels.transcript)}`, '');
  for (const segment of transcript) lines.push(`### ${timecode(segment.startMs)} · ${escape(labels[segment.source])}`, '', escape(segment.text), '');
  return lines.join('\n').trim();
}

export function createMeetingNotes({ notes, store, settings, persistSettings }) {
  const pending = new Map();
  async function createOnce(operationId, value) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await notes.syncSnapshot();
      const result = await notes.syncApply({ deviceId: 'local-meetings', operationId, operation: 'create', value, treeRevision: snapshot.treeRevision });
      if (!result.conflict) return result.value;
    }
    throw new Error('Notes changed while creating this meeting. Retry to resume the same operation.');
  }
  async function folder() {
    const tree = await notes.list();
    const find = items => items.find(item => item.id === settings.folderId && item.kind === 'folder') || items.map(item => find(item.children || [])).find(Boolean);
    if (settings.folderId && find(tree.items)) return settings.folderId;
    if (settings.folderId || !settings.folderOperationId) { settings.folderOperationId = `meeting-folder-${randomUUID()}`; settings.folderId = null; persistSettings(); }
    const created = await createOnce(settings.folderOperationId, { kind: 'folder', label: 'Meetings' });
    settings.folderId = created.id; persistSettings();
    return created.id;
  }
  async function ensure(session) {
    if (session.noteId) return session.noteId;
    if (!session.noteCreate) { session.noteCreate = { parentId: await folder(), label: session.title, content: '' }; store.save(session); }
    const note = await createOnce(`meeting-note-${session.id}`, session.noteCreate);
    session.noteId = note.id; session.generatedTitle = note.label; store.save(session);
    return note.id;
  }
  async function sync(session, transcript, summary) {
    await ensure(session);
    const document = markdown.parse(meetingMarkdown(session, transcript, summary));
    let segmentIndex = 0;
    document.content.forEach((node, index) => {
      node.attrs = { ...node.attrs, blockId: `meeting-${session.id}-${index}` };
      if (node.type === 'heading' && node.attrs.level === 3 && index >= document.content.length - transcript.length * 2) node.attrs.blockId = `meeting-segment-${transcript[segmentIndex++].id}`;
    });
    const generated = markdown.serialize(document), previous = store.readGenerated(session.id);
    // Revision checks belong to the canonical Notes writer, including remote edits.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await notes.read(session.noteId);
      let content = generated;
      let rich = document;
      const sameGenerated = current.content === generated && normalize(current.document) === normalize(document);
      const richEdited = current.document && previous?.document && normalize(current.document) !== normalize(previous.document);
      if (!sameGenerated && current.content && (current.content !== previous?.content || richEdited)) {
        if (previous?.content && current.content.includes(previous.content)) content = current.content.replace(previous.content, generated);
        else { content = `${current.content}\n\n---\n\n${generated}`; session.preservedEdits = true; }
        if (current.document?.content) {
          // Keep rich user blocks intact. Only replace a generated suffix that is unchanged.
          const old = previous?.document?.content || [], nodes = current.document.content;
          const at = old.length ? nodes.findLastIndex(node => node.attrs?.blockId === old[0].attrs?.blockId) : -1;
          if (at >= 0 && old.every((node, index) => normalize(node) === normalize(nodes[at + index]))) rich = { ...current.document, content: [...nodes.slice(0, at), ...document.content, ...nodes.slice(at + old.length)] };
          else {
            // An edited generated copy becomes user content. Keep its formatting, but give
            // its anchors a distinct identity so evidence links still reach the raw transcript.
            const ids = new Set(document.content.map(node => node.attrs?.blockId));
            const preserved = nodes.map(node => ids.has(node.attrs?.blockId) ? { ...node, attrs: { ...node.attrs, blockId: `preserved-${randomUUID()}` } } : node);
            rich = { ...current.document, content: [...preserved, { type: 'horizontalRule' }, ...document.content] };
          }
        }
      }
      if (current.label !== session.generatedTitle) session.titleEdited = true;
      const label = !session.titleEdited ? summary?.title || session.title : current.label;
      try {
        const saved = await notes.save({ id: current.id, label, content, document: rich, revision: current.revision });
        store.saveGenerated(session.id, { content: generated, document });
        session.generatedTitle = label; session.title = label; session.noteRevision = saved.revision; session.noteError = null;
        store.save(session); return saved;
      } catch (error) {
        // Retry only a demonstrated revision race, never overwrite a locked/deleted page.
        if (attempt === 2 || (await notes.read(session.noteId)).revision === current.revision) throw error;
      }
    }
  }
  return { ensure, sync: (...args) => {
    const id = args[0].id, operation = (pending.get(id) || Promise.resolve()).then(() => sync(...args));
    const settled = operation.catch(() => {}).finally(() => { if (pending.get(id) === settled) pending.delete(id); });
    pending.set(id, settled); return operation;
  } };
}
