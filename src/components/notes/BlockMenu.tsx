import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Type, Heading, List, ListOrdered, ListTodo, ChevronRight, Quote, MessageSquare, Code, Columns2, Table2, Image, Sigma, Database, FileText, Minus } from 'lucide-react';

import { blockTypes, transformBlock } from './block-transforms';
import { BlockActionsMenu } from './BlockActionsMenu';

export type BlockMenuProps = { editor: Editor; position: { x: number; y: number }; mode?: 'insert' | 'format' | 'block'; close: () => void; prepare?: () => void; table: () => void; link: () => void; image: () => void; equation: () => void; database: () => void; page: () => void; source: () => void; noteId?: string; action?: (id: string) => void };
function CompactBlockMenu({ editor, position, mode = 'block', close, prepare, table, link, image, equation, database, page }: BlockMenuProps) {
  const menu = useRef<HTMLDivElement>(null), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as HTMLElement)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); editor.commands.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [close, editor]);
  const act = (fn: () => unknown) => { prepare?.(); fn(); close(); };
  const item = (label: string, fn: () => unknown, disabled = false) => <button key={label} role="menuitem" disabled={disabled} onClick={() => act(fn)}>{label}</button>;
  const insertItems: [string, () => unknown][] = [...blockTypes.map(([value, label]) => [label, () => transformBlock(editor, value)] as [string, () => unknown]), ['Table…', table], ['Image or file…', image], ['Equation…', equation], ['Database…', database], ['Page…', page], ['Divider', () => editor.chain().focus().setHorizontalRule().run()]];
  const icons = [Type, Heading, Heading, Heading, Heading, Heading, Heading, List, ListOrdered, ListTodo, ChevronRight, Quote, MessageSquare, Code, Columns2, Columns2, Columns2, Columns2, Table2, Image, Sigma, Database, FileText, Minus];
  const groups = [
    {label:'Basic', indexes:[0,1,2,3,7,8,9]},
    {label:'Data & pages', indexes:[18,21,22]},
    {label:'Media', indexes:[19,13,20]},
    {label:'Layout', indexes:[10,11,12,23,14,15]},
    {label:'More blocks', indexes:[4,5,6,16,17]},
  ];
  const filtered = groups.flatMap(group=>group.indexes).filter(index=>insertItems[index][0].toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const catalogItem = (index:number) => {const [label,fn]=insertItems[index],Icon=icons[index],selected=filtered.indexOf(index)===active;return <button key={index} role="menuitem" data-active={selected} onPointerMove={()=>setActive(filtered.indexOf(index))} onClick={()=>act(fn)}><Icon size={18}/><span>{label}</span></button>;};
  return <div ref={menu} className={`noteBlockMenu noteContextMenu ${mode}`} role="menu" aria-label={mode === 'insert' ? 'Insert a block' : 'Text and block actions'} style={{ left: Math.max(8, Math.min(position.x, innerWidth - 274)), top: Math.max(8, Math.min(position.y, innerHeight - (mode === 'format' ? 220 : 470))) }} onMouseDown={e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
    {mode === 'insert' ? <><input autoFocus aria-label="Search blocks" placeholder="Search blocks…" value={query} onChange={e => {setQuery(e.target.value);setActive(0);}} onKeyDown={e => {
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=(active+(e.key==='ArrowDown'?1:filtered.length-1))%Math.max(1,filtered.length);setActive(next);menu.current?.querySelectorAll('.noteInsertCatalog button')[next]?.scrollIntoView({block:'nearest'});}
      if(e.key==='Enter'&&filtered[active]!==undefined){e.preventDefault();act(insertItems[filtered[active]][1]);}
    }} /><div className="noteInsertCatalog">{groups.map(group=>{const indexes=group.indexes.filter(index=>filtered.includes(index));return indexes.length?<section key={group.label}><small>{group.label}</small>{indexes.map(catalogItem)}</section>:null;})}{!filtered.length&&<p className="noteNoBlocks">No matching blocks</p>}</div></> : <>
      <div className="noteInlineActions">{[['B', 'Bold', () => editor.chain().focus().toggleBold().run()], ['I', 'Italic', () => editor.chain().focus().toggleItalic().run()], ['U', 'Underline', () => editor.chain().focus().toggleUnderline().run()], ['S', 'Strikethrough', () => editor.chain().focus().toggleStrike().run()], ['<>', 'Inline code', () => editor.chain().focus().toggleCode().run()], ['↗', 'Link', link]].map(([label, title, fn]) => <button key={String(title)} title={String(title)} aria-label={String(title)} role="menuitem" onClick={() => act(fn as () => void)}>{String(label)}</button>)}</div>
      <label>Turn into<select aria-label="Turn into" defaultValue="" onChange={e => act(() => transformBlock(editor, e.target.value))}><option value="" disabled>Choose block</option>{blockTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="noteInlineActions">{[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]].map(([alignment, Icon]) => { const ButtonIcon = Icon as typeof AlignLeft; return <button key={String(alignment)} role="menuitem" aria-label={`Align ${alignment}`} title={`Align ${alignment}`} onClick={() => act(() => editor.chain().focus().setTextAlign(String(alignment)).run())}><ButtonIcon size={16} /></button>; })}</div>
      <details><summary>Color</summary><div className="noteColorOptions">{['#a0a0a0', '#a77b61', '#d99b52', '#d8bd65', '#70af8b', '#76aadd', '#ad89d3', '#d988b1', '#dd7878'].map(color => <button key={color} role="menuitem" aria-label={`Text color ${color}`} style={{ color }} onClick={() => act(() => editor.chain().focus().setColor(color).run())}>A</button>)}</div><label>Highlight<input aria-label="Text highlight" type="color" defaultValue="#53442b" onChange={e => editor.chain().focus().setBackgroundColor(e.target.value).run()} /></label>{item('Reset color', () => editor.chain().focus().unsetColor().unsetBackgroundColor().run())}</details>

    </>}
  </div>;
}


export function BlockMenu(props: BlockMenuProps) {
  return props.mode === "block" ? <BlockActionsMenu {...props} /> : <CompactBlockMenu {...props} />;
}
