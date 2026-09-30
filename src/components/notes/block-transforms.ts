import type { Editor } from '@tiptap/react';
import { blockContent, changeColumns, currentBlock, replaceCurrentBlock, selectBlockText } from './block-actions';

export function transformBlock(editor: Editor, kind: string) {
  const original = currentBlock(editor);
  if (original && ['listItem', 'taskItem'].includes(original.node.type.name) && ['bulletList', 'orderedList', 'taskList'].includes(kind)) {
    const list = editor.state.doc.resolve(original.from).parent;
    if (list.type.name === kind) return true;
    return replaceCurrentBlock(editor, [{ type: kind, content: [{ type: kind === 'taskList' ? 'taskItem' : 'listItem', attrs: original.node.attrs, content: original.node.toJSON().content }] }]);
  }
  if (original && ['listItem', 'taskItem'].includes(original.node.type.name)) selectBlockText(editor);
  const chain = editor.chain().focus();
  if (kind === 'paragraph') return chain.clearNodes().setParagraph().run();
  if (/^h[1-6]$/.test(kind)) return chain.clearNodes().setHeading({ level: Number(kind[1]) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  if (kind === 'bulletList') return chain.toggleBulletList().run();
  if (kind === 'orderedList') return chain.toggleOrderedList().run();
  if (kind === 'taskList') return chain.toggleTaskList().run();
  if (kind === 'blockquote') return chain.toggleBlockquote().run();
  if (kind === 'codeBlock') return chain.toggleCodeBlock().run();
  if (kind === 'details') return editor.isActive('details') ? chain.unsetDetails().run() : chain.setDetails().run();
  if (kind === 'callout') return editor.isActive('callout') ? chain.lift('callout').run() : chain.wrapIn('callout').run();
  if (/^toggle[1-4]$/.test(kind)) {
    if (!editor.isActive('details') && !chain.setDetails().run()) return false;
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'details') {
        const pos = $from.before(depth) + 1, node = editor.state.doc.nodeAt(pos)!;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: Number(kind.at(-1)) }));
        return true;
      }
    }
    return false;
  }
  if (/^columns[2-5]$/.test(kind)) {
    if (editor.isActive('columns')) return changeColumns(editor, Number(kind.at(-1)));
    const block = currentBlock(editor);
    if (!block) return false;
    return replaceCurrentBlock(editor, [{ type: 'columns', content: Array.from({ length: Number(kind.at(-1)) }, (_, index) => ({ type: 'column', content: index ? [{ type: 'paragraph' }] : blockContent(editor) })) }]);
  }
  return false;
}
export const blockTypes = [['paragraph', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Heading 6'], ['bulletList', 'Bullet list'], ['orderedList', 'Numbered list'], ['taskList', 'To-do list'], ['details', 'Toggle list'], ['blockquote', 'Quote'], ['callout', 'Callout'], ['codeBlock', 'Code'], ['columns2', '2 columns'], ['columns3', '3 columns'], ['columns4', '4 columns'], ['columns5', '5 columns']];
