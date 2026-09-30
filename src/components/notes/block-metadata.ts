import { Extension } from '@tiptap/core';

export const blockNodeTypes = ['paragraph', 'heading', 'blockquote', 'callout', 'details', 'codeBlock', 'listItem', 'taskItem', 'bulletList', 'orderedList', 'taskList', 'columns', 'image', 'blockMath', 'table', 'syncedBlock'];
export const BlockMetadata = Extension.create({
  name: 'blockMetadata',
  addGlobalAttributes: () => [
    { types: blockNodeTypes, attributes: {
      blockId: { default: null, parseHTML: element => element.getAttribute('data-block-id'), renderHTML: attrs => attrs.blockId ? { 'data-block-id': attrs.blockId, id: `block-${attrs.blockId}` } : {} },
      comments: { default: [], parseHTML: () => [], renderHTML: attrs => { const count = (attrs.comments || []).filter((comment: { resolved?: boolean }) => !comment.resolved).length; return count ? { 'data-comment-count': count } : {}; } },
    } },
    { types: ['bulletList', 'orderedList'], attributes: {
      listStyle: { default: null, parseHTML: element => element.style.listStyleType || null, renderHTML: attrs => ['disc', 'circle', 'square', 'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'].includes(attrs.listStyle) ? { style: `list-style-type: ${attrs.listStyle}` } : {} },
    } },
    { types: ['detailsSummary'], attributes: {
      level: { default: null, parseHTML: element => Number(element.getAttribute('data-heading-level')) || null, renderHTML: attrs => [1, 2, 3, 4].includes(attrs.level) ? { 'data-heading-level': attrs.level, role: 'heading', 'aria-level': attrs.level } : {} },
    } },
  ],
});
