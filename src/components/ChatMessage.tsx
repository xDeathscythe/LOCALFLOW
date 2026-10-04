import { memo } from 'react';
import type { NiwaMessage } from '../lib/niwa';
import { ChangesCard, WorkDetails } from './ChatWork';
import { MarkdownContent, MessageActions } from './MarkdownContent';

export const ChatMessage = memo(function ChatMessage({ message, diff, canUndo, onView, onUndo }: {
  message: NiwaMessage; diff: string; canUndo: boolean;
  onView: (patch: string, file?: string) => void; onUndo: (patch: string) => Promise<void>;
}) {
  return <article className={`niwaBubble ${message.role}`}>
    {message.work && <WorkDetails work={message.work} />}
    <MarkdownContent content={message.content} streaming={message.streaming} />
    {message.role === 'assistant' && <>
      <ChangesCard diff={diff} canUndo={canUndo} onView={file => onView(diff, file)} onUndo={() => onUndo(diff)} />
      <MessageActions content={message.content} />
    </>}
  </article>;
});
