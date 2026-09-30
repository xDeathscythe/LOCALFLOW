import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { MarkdownContent } from '../MarkdownContent';

function SyncedBlockView({ node, extension }: NodeViewProps) {
  const [content, setContent] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const refresh = () => { void window.localflow.notesRead(node.attrs.sourceId).then(note => { if (live) { setContent(note.content); setError(''); } }).catch(error => { if (live) setError(String(error)); }); };
    refresh(); const off = window.localflow.onNiwaEvent(event => { if (event.type === 'notes-changed') refresh(); });
    return () => { live = false; off(); };
  }, [node.attrs.sourceId]);
  return <NodeViewWrapper className="noteSyncedBlock" contentEditable={false}><header><span>Synced block</span><button onClick={() => extension.options.openNote?.(node.attrs.sourceId)}>Edit source</button></header>{error ? <p role="alert">{error}</p> : <MarkdownContent content={content} />}</NodeViewWrapper>;
}

export const SyncedBlock = Node.create<{ openNote?: (id: string) => void }>({
  name: 'syncedBlock', group: 'block', atom: true, draggable: true,
  addOptions: () => ({ openNote: undefined }),
  addAttributes: () => ({ sourceId: { default: '', parseHTML: element => element.getAttribute('data-source-id'), renderHTML: attrs => ({ 'data-source-id': attrs.sourceId }) } }),
  parseHTML: () => [{ tag: 'div[data-type="synced-block"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'synced-block' })],
  renderMarkdown: node => `<div data-type="synced-block" data-source-id="${String(node.attrs?.sourceId || '').replace(/[^\w-]/g, '')}"></div>`,
  addNodeView: () => ReactNodeViewRenderer(SyncedBlockView),
});
