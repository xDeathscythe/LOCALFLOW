import { Extension } from '@tiptap/core';

export const blockTones = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export const BlockAppearance = Extension.create({
  name: 'blockAppearance',
  addGlobalAttributes: () => [{
    types: ['paragraph', 'heading', 'blockquote', 'callout', 'column', 'details', 'codeBlock', 'listItem', 'taskItem', 'bulletList', 'orderedList', 'taskList'],
    attributes: { tone: {
      default: 'default',
      parseHTML: element => {
        const tone = element.getAttribute('data-block-tone');
        return blockTones.find(value => value === tone || element.classList.contains(`highlight-${value}_background`)) || 'default';
      },
      renderHTML: attrs => blockTones.includes(attrs.tone) && attrs.tone !== 'default' ? { 'data-block-tone': attrs.tone } : {},
    } },
  }],
});
