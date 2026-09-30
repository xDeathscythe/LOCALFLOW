import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronRight, Code, Copy, GripVertical, Link, List, ListOrdered, ListTodo, Heading, Quote, Columns2, Sigma, MessageSquare, Paintbrush, Play, Search, Sparkles, Trash2, Type, WandSparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BlockMenuProps } from './BlockMenu';
import { blockTypes, transformBlock } from './block-transforms';
import { changeColumns, currentBlock, moveBlock, selectBlockText } from './block-actions';
import { blockTones } from './block-appearance';
import { ColumnLayout } from './ColumnLayout';
import './block-menu.css';

type Action = { id: string; label: string; icon?: LucideIcon; run?: () => unknown; children?: Action[]; checked?: boolean; disabled?: boolean; color?: string; tone?: string; shortcut?: string };
const colors = ['inherit', '#a0a0a0', '#a77b61', '#d99b52', '#d8bd65', '#70af8b', '#76aadd', '#ad89d3', '#d988b1', '#dd7878'];
const typeIcons: Record<string, LucideIcon> = { paragraph: Type, bulletList: List, orderedList: ListOrdered, taskList: ListTodo, details: ChevronRight, blockquote: Quote, callout: MessageSquare, codeBlock: Code };
const searchText = (text: string) => text.normalize('NFKC').toLocaleLowerCase();
const withoutIdentity = (value: unknown) => JSON.parse(JSON.stringify(value, (key, entry) => key === 'blockId' || key === 'comments' ? undefined : entry));

export function BlockActionsMenu({ editor, position, close, action, table, image, equation, database, page, source, link }: BlockMenuProps) {
  const root = useRef<HTMLDivElement>(null), sub = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(''), [flyout, setFlyout] = useState<{ id: string; top: number } | null>(null), [error, setError] = useState('');
  const [lastColor, setLastColor] = useState(() => { try { return localStorage.getItem('localflow.notes.last-color') || ''; } catch { return ''; } });
  const block = currentBlock(editor), name = block?.node.type.name;
  const listType = editor.isActive('orderedList') ? 'orderedList' : editor.isActive('bulletList') ? 'bulletList' : '';
  const colorActions: Action[] = blockTones.flatMap((tone, index) => [
    { id: `text-${tone}`, label: `${tone === 'default' ? 'Default' : tone[0].toUpperCase() + tone.slice(1)} text`, color: colors[index], icon: Type, run: () => { selectBlockText(editor); return index ? editor.chain().focus().setColor(colors[index]).run() : editor.chain().focus().unsetColor().run(); } },
    { id: `background-${tone}`, label: `${tone === 'default' ? 'Default' : tone[0].toUpperCase() + tone.slice(1)} background`, tone, icon: Paintbrush, checked: block?.node.attrs.tone === tone, run: () => { const current = currentBlock(editor); if (current && 'tone' in current.node.attrs) editor.view.dispatch(editor.state.tr.setNodeMarkup(current.from, undefined, { ...current.node.attrs, tone })); } },
  ]);
  const transforms: Action[] = blockTypes.map(([id, label]) => ({ id, label, icon: typeIcons[id] || (id.startsWith('columns') ? Columns2 : Heading), checked: id.startsWith('h') ? name === 'heading' && block?.node.attrs.level === Number(id[1]) : editor.isActive(id), run: () => transformBlock(editor, id) }));
  transforms.splice(7, 0, { id: 'page', label: 'Page', icon: ArrowRight, run: () => action?.('page') }, { id: 'page-in', label: 'Page in…', icon: ArrowRight, run: () => action?.('page-in') });
  transforms.push({ id: 'synced', label: 'Synced block', icon: Copy, disabled: name === 'syncedBlock', run: () => action?.('synced') });
  transforms.push({ id: 'math', label: 'Block equation', icon: Sigma, run: () => action?.('math') }, ...[1, 2, 3, 4].map(level => ({ id: `toggle${level}`, label: `Toggle heading ${level}`, icon: ChevronRight, run: () => transformBlock(editor, `toggle${level}`) })));
  const listActions: Action[] = (listType === 'orderedList' ? [['decimal', '1. 2. 3.'], ['lower-alpha', 'a. b. c.'], ['upper-alpha', 'A. B. C.'], ['lower-roman', 'i. ii. iii.'], ['upper-roman', 'I. II. III.']] : [['disc', '● Bullet'], ['circle', '○ Circle'], ['square', '■ Square']]).map(([id, label]) => ({ id, label, checked: editor.getAttributes(listType).listStyle === id, run: () => editor.chain().focus().updateAttributes(listType, { listStyle: id }).run() }));
  if (listType === 'orderedList') listActions.push({ id: 'restart', label: 'Start at…', run: () => action?.('list-start') });
  listActions.push({ id: 'indent', label: 'Indent', run: () => editor.chain().focus().sinkListItem(name === 'taskItem' ? 'taskItem' : 'listItem').run() }, { id: 'outdent', label: 'Outdent', run: () => editor.chain().focus().liftListItem(name === 'taskItem' ? 'taskItem' : 'listItem').run() });
  const actions: Action[] = [
    { id: 'turn', label: 'Turn into', icon: ArrowRight, children: transforms },
    { id: 'color', label: 'Color', icon: Paintbrush, children: colorActions },
    { id: 'list', label: 'List format', icon: List, disabled: !listType && name !== 'taskItem', children: listActions },
    { id: 'copy-link', label: 'Copy link to block', icon: Link, shortcut: 'Alt+Shift+L', run: () => action?.('copy-link') },
    { id: 'duplicate', label: 'Duplicate', icon: Copy, shortcut: 'Ctrl+D', run: () => { const current = currentBlock(editor); if (current) return editor.chain().focus().insertContentAt(current.to, withoutIdentity(current.node.toJSON())).run(); } },
    { id: 'move', label: 'Move to', icon: ArrowRight, children: [{ id: 'up', label: 'Move block up', run: () => moveBlock(editor, -1) }, { id: 'down', label: 'Move block down', run: () => moveBlock(editor, 1) }, { id: 'move-page', label: 'Another page…', run: () => action?.('move') }] },
    { id: 'delete', label: 'Delete', icon: Trash2, shortcut: 'Del', run: () => { const current = currentBlock(editor); if (current) return editor.chain().focus().deleteRange({ from: current.from, to: current.to }).run(); } },
    { id: 'comment', label: 'Comment', icon: MessageSquare, shortcut: 'Ctrl+Shift+M', run: () => action?.('comment') },
    { id: 'suggest', label: 'Suggest edits', icon: WandSparkles, run: () => action?.('suggest') },
    { id: 'present', label: 'Present from here', icon: Play, run: () => action?.('present') },
    { id: 'ask', label: 'Ask AI', icon: Sparkles, shortcut: 'Ctrl+J', run: () => action?.('ask') },
    { id: 'skills', label: 'Skills', icon: WandSparkles, children: [['improve', 'Improve writing'], ['proofread', 'Proofread'], ['explain', 'Explain'], ['reformat', 'Reformat']].map(([id, label]) => ({ id, label, icon: Sparkles, run: () => action?.(id) })) },
    { id: 'format', label: 'Formatting', icon: Type, children: [
      { id: 'bold', label: 'Bold', run: () => { selectBlockText(editor); return editor.chain().focus().toggleBold().run(); } },
      { id: 'italic', label: 'Italic', run: () => { selectBlockText(editor); return editor.chain().focus().toggleItalic().run(); } },
      { id: 'link', label: 'Link…', run: link },
      ...['left', 'center', 'right', 'justify'].map(alignment => ({ id: `align-${alignment}`, label: `Align ${alignment}`, run: () => { selectBlockText(editor); return editor.chain().focus().setTextAlign(alignment).run(); } })),
      { id: 'clear', label: 'Clear formatting', run: () => { selectBlockText(editor); return editor.chain().focus().unsetAllMarks().unsetTextAlign().run(); } },
    ] },
    { id: 'insert', label: 'Insert', icon: GripVertical, children: [['Table…', table], ['Image or file…', image], ['Equation…', equation], ['Database…', database], ['Page…', page]].map(([label, run], index) => ({ id: `insert-${index}`, label: String(label), run: run as () => void })) },
    { id: 'more', label: 'More', children: [{ id: 'undo', label: 'Undo', disabled: !editor.can().undo(), run: () => editor.chain().focus().undo().run() }, { id: 'redo', label: 'Redo', disabled: !editor.can().redo(), run: () => editor.chain().focus().redo().run() }, { id: 'source', label: 'Edit Markdown', run: source }] },
  ];
  if (editor.isActive('columns')) actions.push({ id: 'columns', label: 'Columns', children: [...[2, 3, 4, 5].map(count => ({ id: `count-${count}`, label: `${count} columns`, run: () => changeColumns(editor, count) })), { id: 'stack', label: 'Stack into one column', run: () => changeColumns(editor, 1) }] });
  if (editor.isActive('table')) actions.push({ id: 'table', label: 'Table', children: [
    ['Row above', () => editor.chain().focus().addRowBefore().run()], ['Row below', () => editor.chain().focus().addRowAfter().run()], ['Column before', () => editor.chain().focus().addColumnBefore().run()], ['Column after', () => editor.chain().focus().addColumnAfter().run()], ['Delete row', () => editor.chain().focus().deleteRow().run()], ['Delete column', () => editor.chain().focus().deleteColumn().run()], ['Header row', () => editor.chain().focus().toggleHeaderRow().run()], ['Header column', () => editor.chain().focus().toggleHeaderColumn().run()], ['Merge cells', () => editor.chain().focus().mergeCells().run()], ['Split cell', () => editor.chain().focus().splitCell().run()], ['Delete table', () => editor.chain().focus().deleteTable().run()],
  ].map(([label, run], index) => ({ id: `table-${index}`, label: String(label), run: run as () => void })) });
  const groups = query ? actions.flatMap(item => item.children ? [{ label: item.label, items: item.disabled ? [] : item.children.filter(child => searchText(`${item.label} ${child.label}`).includes(searchText(query))) }] : [{ label: '', items: searchText(item.label).includes(searchText(query)) ? [item] : [] }]).filter(group => group.items.length) : [{ label: blockTypes.find(([id]) => id === (name === 'heading' ? `h${block?.node.attrs.level}` : name))?.[1] || (listType === 'orderedList' ? 'Numbered list' : listType === 'bulletList' ? 'Bullet list' : 'Block'), items: actions }];
  const opened = actions.find(item => item.id === flyout?.id);
  const left = Math.max(8, Math.min(position.x, innerWidth - 282)), top = Math.max(8, Math.min(position.y, innerHeight - 540));
  const execute = async (item: Action) => {
    try {
      const result = await item.run?.();
      if (result === false) { setError('This action cannot be applied to this block.'); return; }
      if (colorActions.some(color => color.id === item.id)) { setLastColor(item.id); try { localStorage.setItem('localflow.notes.last-color', item.id); } catch { /* Color history is optional. */ } }
      close();
    } catch (failure) { setError(String(failure)); }
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !sub.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [close]);
  const keydown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const panel = (event.target as HTMLElement).closest('.noteActionPanel')!, buttons = [...panel.querySelectorAll<HTMLButtonElement>('button[role=menuitem]:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape' || event.key === 'ArrowLeft' && panel === sub.current) { event.preventDefault(); event.stopPropagation(); if (flyout) { setFlyout(null); root.current?.querySelector<HTMLButtonElement>(`[data-action="${flyout.id}"]`)?.focus(); } else { close(); editor.commands.focus(); } }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]; next?.focus(); next?.scrollIntoView({ block: 'nearest' }); }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); buttons[0]?.click(); }
    if (event.key === 'ArrowRight' && document.activeElement instanceof HTMLButtonElement && document.activeElement.getAttribute('aria-haspopup')) { event.preventDefault(); document.activeElement.click(); requestAnimationFrame(() => sub.current?.querySelector<HTMLButtonElement>('button')?.focus()); }
    if ((event.ctrlKey || event.metaKey) && ['d', 'j'].includes(event.key.toLowerCase())) { event.preventDefault(); void execute(actions.find(item => item.id === (event.key.toLowerCase() === 'd' ? 'duplicate' : 'ask'))!); }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') { event.preventDefault(); void execute(actions.find(item => item.id === 'comment')!); }
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); void execute(actions.find(item => item.id === 'copy-link')!); }
    if (event.key === 'Delete' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); void execute(actions.find(item => item.id === 'delete')!); }
    if (event.key === 'Tab') { close(); editor.commands.focus(); }
  };
  const row = (item: Action) => { const Icon = item.icon || Type; return <button key={item.id} type="button" role="menuitem" data-action={item.id} disabled={item.disabled} aria-haspopup={item.children ? 'menu' : undefined} aria-expanded={item.children ? flyout?.id === item.id : undefined} onPointerEnter={event => { if (item.children) setFlyout({ id: item.id, top: event.currentTarget.getBoundingClientRect().top }); else if (!sub.current?.contains(event.currentTarget)) setFlyout(null); }} onClick={event => item.children ? setFlyout({ id: item.id, top: event.currentTarget.getBoundingClientRect().top }) : void execute(item)}><Icon size={16} style={{ color: item.color }} data-block-tone={item.tone} /><span>{item.label}</span>{item.checked && <Check size={14} />}{item.shortcut && <kbd>{item.shortcut}</kbd>}{item.children && <ChevronRight size={14} />}</button>; };
  const last = colorActions.find(item => item.id === lastColor);
  return createPortal(<>
    <div ref={root} className="noteActionPanel noteContextMenu noteNotionMenu" role="menu" aria-label="Block actions menu" style={{ left, top }} onKeyDown={keydown}>
      <div className="noteActionSearch"><Search size={14} /><input autoFocus aria-label="Search actions" placeholder="Search actions…" value={query} onChange={event => { setQuery(event.target.value); setFlyout(null); setError(''); }} /></div>
      <div className="noteActionScroll">{groups.map((group, index) => <section key={index}>{group.label && <small>{group.label}</small>}{group.items.map(row)}</section>)}{!groups.length && <p>No matching actions</p>}{last && !query && <section><small>Last used</small>{row(last)}</section>}{!query && <ColumnLayout editor={editor} />}</div>
      {error && <p role="alert">{error}</p>}
      <footer>{block?.node.textContent.length || 0} characters</footer>
    </div>
    {opened?.children && <div ref={sub} className="noteActionPanel noteActionFlyout" role="menu" aria-label={opened.label} style={{ left: left + 550 < innerWidth ? left + 273 : Math.max(8, left - 267), top: Math.max(8, Math.min(flyout!.top, innerHeight - Math.min(500, opened.children.length * 34 + 20))) }} onKeyDown={keydown}><div className="noteActionScroll">{opened.children.map(row)}</div></div>}
  </>, document.body);
}
