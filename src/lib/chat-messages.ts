import { useEffect, useRef, useState } from 'react';
import type { NiwaEvent, NiwaMessage } from './niwa';

export function mergeMessage(messages: NiwaMessage[], message: NiwaMessage): NiwaMessage[] {
  return messages.some(value => value.id === message.id)
    ? messages.map(value => value.id === message.id ? message : value)
    : [...messages, message];
}

export function useChatMessages() {
  const [messages, setMessages] = useState<NiwaMessage[]>([]);
  const pending = useRef(new Map<string, NiwaMessage>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; pending.current.clear(); };
  const flush = () => {
    clearTimeout(timer.current); timer.current = undefined;
    const deltas = [...pending.current.values()]; pending.current.clear();
    if (!deltas.length) return;
    setMessages(current => {
      const updates = new Map(deltas.map(message => [message.id, message]));
      const next = current.map(message => {
        const delta = updates.get(message.id); updates.delete(message.id);
        return delta ? { ...message, streaming: true, content: message.content + delta.content } : message;
      });
      return [...next, ...updates.values()];
    });
  };
  useEffect(() => cancel, []);
  const receive = (event: NiwaEvent) => {
    if (event.type === 'delta' && event.id) {
      const previous = pending.current.get(event.id);
      pending.current.set(event.id, { id: event.id, role: 'assistant', streaming: true, timestamp: previous?.timestamp ?? Date.now(), turnId: event.turnId, content: (previous?.content || '') + (event.text || '') });
      timer.current ??= setTimeout(flush, 50);
    } else if (event.type === 'message' && event.id) {
      flush();
      setMessages(current => mergeMessage(current, { id: event.id!, role: event.role!, content: event.content!, timestamp: event.timestamp!, turnId: event.turnId, work: event.work }));
    } else if (event.type === 'busy' && !event.busy) {
      flush(); setMessages(current => current.map(message => message.streaming ? { ...message, streaming: false } : message));
    }
  };
  return { messages, receive, prepend: (earlier: NiwaMessage[]) => setMessages(current => { const ids = new Set(current.map(message => message.id)); return [...earlier.filter(message => !ids.has(message.id)), ...current]; }), replace: (next: NiwaMessage[]) => { cancel(); setMessages(next); }, clear: () => { cancel(); setMessages([]); } };
}
