import { useEditorState, type Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';

function columnGroup(editor: Editor) {
  const selection = editor.state.selection;
  if (selection instanceof NodeSelection && selection.node.type.name === 'columns') return { node: selection.node, pos: selection.from };
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    if (selection.$from.node(depth).type.name === 'columns') return { node: selection.$from.node(depth), pos: selection.$from.before(depth) };
  }
  return null;
}
export function ColumnLayout({ editor }: { editor: Editor }) {
  const widths = useEditorState({ editor, selector: () => {
    const group = columnGroup(editor);
    return group ? group.node.content.content.map(column => Number(column.attrs.width) || 100 / group.node.childCount) : [];
  } });
  if (!widths.length) return null;
  const total = widths.reduce((a, b) => a + b, 0), normalized = widths.map(width => width / total * 100);
  const apply = (values: number[]) => {
    const group = columnGroup(editor);
    if (!group) return;
    const tr = editor.state.tr;
    group.node.forEach((column, offset, index) => tr.setNodeMarkup(group.pos + 1 + offset, undefined, { ...column.attrs, width: values[index] }));
    editor.view.dispatch(tr);
  };
  return <details className="noteColumnLayout" open><summary>Column widths</summary>
    {normalized.map((width, index) => <label key={index}><span>{index + 1}</span><input aria-label={`Column ${index + 1} width`} type="range" min="5" max={100 - (widths.length - 1) * 5} step="1" value={width} onChange={event => {
      const next = Number(event.target.value), rest = 100 - width;
      apply(normalized.map((value, i) => i === index ? next : value / rest * (100 - next)));
    }}/><output>{Math.round(width)}%</output></label>)}
    <div className="noteColumnPresets"><button onClick={() => apply(widths.map(() => 100 / widths.length))}>Equal</button>{widths.length === 2 && <><button onClick={() => apply([25, 75])}>1 : 3</button><button onClick={() => apply([75, 25])}>3 : 1</button></>}</div>
  </details>;
}
