import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Plus, ShieldCheck, Square, X, FileText } from 'lucide-react';
import type { NiwaSettings, NiwaSnapshot } from '../lib/niwa';

export function AgentComposer({ draftKey, snapshot, disabled, busy, voiceControls, configure, connect, send, interrupt, onError }: {
  draftKey: number;
  snapshot: NiwaSnapshot | null; disabled: boolean; busy: boolean; voiceControls: ReactNode;
  configure: (patch: Partial<NiwaSettings>) => Promise<void>; connect: () => void; send: (text: string) => Promise<void>; interrupt: () => void; onError: (message: string) => void;
}) {
  const [input, setInput] = useState(''), [attachments, setAttachments] = useState<string[]>([]);
  const sending = useRef(false), generation = useRef(draftKey);
  generation.current = draftKey;
  useEffect(() => { setInput(''); setAttachments([]); }, [draftKey]);
  const submit = async () => {
    const text = [input.trim(), attachments.length ? `Attached local files:\n${attachments.map(path => JSON.stringify(path)).join('\n')}` : ''].filter(Boolean).join('\n\n');
    if (!text || busy || sending.current) return;
    const before = generation.current;
    sending.current = true;
    try { await send(text); if (generation.current === before) { setInput(current => current === input ? '' : current); setAttachments(current => current === attachments ? [] : current); } }
    catch (error) { onError(String(error)); }
    finally { sending.current = false; }
  };
  const attach = async () => {
    const before = generation.current;
    try { const paths = await window.localflow.niwaSelectFiles(); if (generation.current === before) setAttachments(current => [...new Set([...current, ...paths])]); }
    catch (error) { onError(String(error)); }
  };
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const element = textarea.current; if (element) { element.style.height = '0px'; element.style.height = `${Math.min(180, Math.max(44, element.scrollHeight))}px`; } }, [input]);
  return <div className="niwaComposer" data-has-input={Boolean(input.trim() || attachments.length)}>
    {!!attachments.length && <div className="chatAttachments">{attachments.map(path => <span key={path} title={path}><FileText size={13} /><span>{path.split(/[\\/]/).at(-1)}</span><button aria-label={`Remove ${path}`} onClick={() => setAttachments(attachments.filter(item => item !== path))}><X size={12} /></button></span>)}</div>}
    <textarea ref={textarea} aria-label="Message Niwa" value={input} onChange={event => setInput(event.target.value)} placeholder="Do anything" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!event.repeat) void submit(); } }} />
    <div className="composerFooter">
      <button className="composerAdd" title="Add files" aria-label="Add files" disabled={busy} onClick={attach}><Plus size={18} /></button>
      {snapshot && <label className="composerPermissions" title="Agent permissions"><ShieldCheck size={14} /><select aria-label="Agent permissions" value={snapshot.settings.access} disabled={disabled} onChange={event => void configure({ access: event.target.value as NiwaSettings['access'] })}><option value="read">Read only</option><option value="workspace">Ask for approval</option><option value="full">Full access</option></select></label>}
      <div className="codingControls" aria-label="Coding agent settings">
        {snapshot && <><select aria-label="Coding model" title={snapshot.settings.cwd} value={snapshot.settings.model} disabled={disabled} onChange={event => void configure({ model: event.target.value })}>{!snapshot.models.length && <option value={snapshot.settings.model}>{snapshot.settings.model || 'Choose model'}</option>}{snapshot.models.map(model => <option key={model.model} value={model.model}>{model.displayName}</option>)}</select><select className="reasoningSelect" aria-label="Reasoning effort" title="Reasoning effort" value={snapshot.settings.effort} disabled={disabled} onChange={event => void configure({ effort: event.target.value })}>{(snapshot.models.find(model => model.model === snapshot.settings.model)?.supportedReasoningEfforts || [{ reasoningEffort: snapshot.settings.effort }]).map(item => <option key={item.reasoningEffort}>{item.reasoningEffort}</option>)}</select>{!snapshot.models.length && <button className="connectModel" disabled={disabled} onClick={connect}>Connect</button>}</>}
      </div>
      {voiceControls}
      {busy ? <button className="composerSend" title="Stop task" aria-label="Stop task" onClick={interrupt}><Square size={14} fill="currentColor" /></button> : (input.trim() || attachments.length > 0) && <button className="composerSend" title="Send message" aria-label="Send message" onClick={() => void submit()}><ArrowUp size={18} /></button>}
    </div>
  </div>;
}
