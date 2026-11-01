import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import Image from '@tiptap/extension-image';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Mathematics from '@tiptap/extension-mathematics';
import TextAlign from '@tiptap/extension-text-align';
import { DatabaseEmbed } from './DatabaseEmbed';
import { BlockAppearance } from './block-appearance';
import { BlockMetadata } from './block-metadata';
import { SyncedBlock } from './SyncedBlock';
import { assetUrl } from '../../lib/asset-url';

const block = (name: string, tag: string, selector: string, content = 'block+') => Node.create({
  name, group: 'block', content, defining: true,
  parseHTML: () => [{ tag: selector }],
  renderHTML: ({ HTMLAttributes }) => [tag, mergeAttributes(HTMLAttributes, { 'data-type': name }), 0],
  renderMarkdown: (node, helpers) => `<${tag} data-type="${name}">\n\n${helpers.renderChildren(node.content || [], '\n\n')}\n\n</${tag}>`,
});
const Callout = block('callout', 'aside', 'aside, figure.callout');
const Columns = block('columns', 'div', 'div[data-type="columns"], .column-list', 'column{2,5}');
const Column = block('column', 'div', 'div[data-type="column"], .column').extend({
  addAttributes:()=>({width:{default:null,parseHTML:element=>{const width=Number(element.getAttribute('data-column-width'))||Number(element.getAttribute('data-notion-column-ratio'))*100||parseFloat(element.style.width);return Number.isFinite(width)&&width>0&&width<=100?width:null;},renderHTML:attrs=>attrs.width>0&&attrs.width<=100?{'data-column-width':attrs.width,style:`flex: ${attrs.width} 1 0%`}:{} }}),
  renderMarkdown:(node,helpers)=>`<div data-type="column"${node.attrs?.width?` data-column-width="${node.attrs.width}"`:''}>\n\n${helpers.renderChildren(node.content||[],'\n\n')}\n\n</div>`,
});
const Attachment = Node.create({
  name: 'attachment', group: 'block', atom: true,
  addAttributes: () => ({ href: { default: '' }, title: { default: 'Attachment' } }),
  parseHTML: () => [{ tag: 'a[data-type="attachment"]', getAttrs: element => ({ href: element.getAttribute('href'), title: element.textContent }) }],
  renderHTML: ({ node }) => ['a', { 'data-type': 'attachment', href: node.attrs.href }, node.attrs.title],
  renderMarkdown: node => `[${String(node.attrs?.title).replace(/[[\]]/g, '\\$&')}](${node.attrs?.href})`,
});

const PageIcon=Node.create({name:'pageIcon',group:'inline',inline:true,atom:true,priority:1100,
  addAttributes:()=>({src:{default:''},alt:{default:''}}),parseHTML:()=>[{tag:'img.icon'},{tag:'img[data-type="page-icon"]'}],
  renderHTML:({HTMLAttributes})=>['img',mergeAttributes(HTMLAttributes,{src:assetUrl(HTMLAttributes.src),'data-type':'page-icon',width:18,height:18})],
  renderMarkdown:node=>node.attrs?.alt||'',
});
const NoteImage = Image.extend({ addAttributes() { return {...this.parent?.(),src:{default:null,parseHTML:element=>element.getAttribute('data-asset-src')||element.getAttribute('src'),renderHTML:attrs=>({src:assetUrl(attrs.src),'data-asset-src':attrs.src})}}; } });
// Markdown remains readable; rich structure is also saved with a matching Markdown revision.
export const noteExtensions = (openNote?: (id:string)=>void) => [
  StarterKit.configure({ link: { openOnClick: false, protocols: ['localflow-note', 'localflow-asset'] } }),
  Markdown, TableKit.configure({ table: { resizable: true } }), TaskList, TaskItem.configure({ nested: true }),
  Details.configure({ persist: true }), DetailsSummary, DetailsContent, NoteImage.configure({ allowBase64: false, resize: { enabled: true, directions: ['bottom-left', 'bottom-right'], minWidth: 48, minHeight: 32, alwaysPreserveAspectRatio: true } }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextStyleKit, Mathematics.configure({ katexOptions: { throwOnError: false, trust: false } }),
  Callout, Columns, Column, Attachment, PageIcon, BlockAppearance, BlockMetadata, SyncedBlock.configure({openNote}), DatabaseEmbed.configure({openNote}),
];
