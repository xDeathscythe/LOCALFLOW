import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

// A list row is a block; tables stay together. Structural node IDs never depend on language.
export function currentBlock(editor: Editor, position = editor.state.selection.from) {
  const { doc } = editor.state;
  const $pos = doc.resolve(Math.max(0, Math.min(position, doc.content.size)));
  if (editor.state.selection instanceof NodeSelection && position === editor.state.selection.from) return { from: position, to: position + editor.state.selection.node.nodeSize, node: editor.state.selection.node };
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (['listItem', 'taskItem'].includes($pos.node(depth).type.name)) return { from: $pos.before(depth), to: $pos.after(depth), node: $pos.node(depth) };
    if (['doc', 'column', 'detailsContent', 'callout'].includes($pos.node(depth - 1).type.name)) return { from: $pos.before(depth), to: $pos.after(depth), node: $pos.node(depth) };
  }
  const node = doc.nodeAt(position);
  return node ? { from: position, to: position + node.nodeSize, node } : null;
}

export function moveBlock(editor: Editor, direction: -1 | 1) {
  const block = currentBlock(editor);
  if (!block) return false;
  const $from = editor.state.doc.resolve(block.from), index = $from.index(), parent = $from.parent;
  if (index + direction < 0 || index + direction >= parent.childCount) return false;
  const neighbor = parent.child(index + direction);
  const from = direction < 0 ? block.from - neighbor.nodeSize : block.from;
  const to = direction < 0 ? block.to : block.to + neighbor.nodeSize;
  const tr = editor.state.tr.replaceWith(from, to, direction < 0 ? [block.node, neighbor] : [neighbor, block.node]);
  const selected = direction < 0 ? from : from + neighbor.nodeSize;
  tr.setSelection(NodeSelection.create(tr.doc, selected));
  editor.view.dispatch(tr.scrollIntoView()); editor.commands.focus();
  return true;
}

export function changeColumns(editor: Editor, count: number) {
  const { $from } = editor.state.selection;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== 'columns') depth--;
  if (!depth) return false;
  const node = $from.node(depth), columns = node.content.content.map(child => child.toJSON());
  // Removing a column retains its blocks in the final remaining column.
  if (count < columns.length) columns[count - 1].content = [...(columns[count - 1].content || []), ...columns.slice(count).flatMap(column => column.content || [])];
  while (columns.length < count) columns.push({ type: 'column', content: [{ type: 'paragraph' }] });
  return editor.chain().focus().insertContentAt({ from: $from.before(depth), to: $from.after(depth) }, count === 1 ? columns[0].content! : { type: 'columns', content: columns.slice(0, count) }).run();
}

export function selectBlockText(editor: Editor) {
  const block = currentBlock(editor);
  if (!block) return;
  const start = TextSelection.near(editor.state.doc.resolve(block.from + 1), 1);
  const end = TextSelection.near(editor.state.doc.resolve(block.to - 1), -1);
  editor.commands.setTextSelection({ from: start.from, to: end.to });
}

export function blockContent(editor: Editor) {
  const block = currentBlock(editor);
  if (!block) return [];
  return ['listItem', 'taskItem'].includes(block.node.type.name) ? block.node.toJSON().content! : [block.node.toJSON()];
}

export function replaceCurrentBlock(editor: Editor, content: JSONContent[]) {
  const block = currentBlock(editor);
  if (!block) return false;
  if (!['listItem', 'taskItem'].includes(block.node.type.name)) return editor.commands.insertContentAt({ from: block.from, to: block.to }, content);
  const $from = editor.state.doc.resolve(block.from), list = $from.parent, index = $from.index();
  const items = list.toJSON().content!, before = items.slice(0, index), after = items.slice(index + 1);
  const wrap = (items: JSONContent[], offset: number) => ({ type: list.type.name, attrs: { ...list.attrs, ...(list.type.name === 'orderedList' ? { start: (list.attrs.start || 1) + offset } : {}) }, content: items });
  return editor.commands.insertContentAt({ from: $from.before(), to: $from.after() }, [...(before.length ? [wrap(before, 0)] : []), ...content, ...(after.length ? [wrap(after, index + 1)] : [])]);
}

export function insertAfterBlock(editor: Editor) {
  const block = currentBlock(editor);
  const at = block?.to ?? editor.state.doc.content.size;
  const tr = editor.state.tr.insert(at, editor.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  editor.view.dispatch(tr.scrollIntoView()); editor.commands.focus();
}
