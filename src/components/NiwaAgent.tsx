import { useEffect, useRef, useState } from 'react';
import { Asterisk, Mic, AudioLines, Square, Settings2, PanelRight, Plus, MessageCircle } from 'lucide-react';
import { NiwaVoice, type NiwaApproval, type NiwaMessage, type NiwaSettings, type NiwaSnapshot } from '../lib/niwa';
import { AgentComposer } from './AgentComposer';
import { ChangesCard, WorkDetails, type ChatWork } from './ChatWork';
import { AgentDiff } from './AgentDiff';
import { ProjectSidebar } from './ProjectSidebar';
import { MarkdownContent, MessageActions } from './MarkdownContent';
import type { AgentActivity } from '../lib/workspace';
import { BrowserConnection } from './BrowserConnection';

export function NiwaAgent({ sidebar, visible, shortcutLabel, recording, microphoneBusy, claimMicrophone, releaseMicrophone, onLocalRecord, onVoiceActive, onListening, onMode }: {
  sidebar: HTMLElement | null; visible: boolean; shortcutLabel: string; recording: boolean; microphoneBusy: boolean; onLocalRecord: () => void; onVoiceActive: (active: boolean) => void; onMode: (mode: string) => void;
  claimMicrophone: () => boolean; releaseMicrophone: () => void;
  onListening: (active: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<NiwaSnapshot | null>(null);
  const [messages, setMessages] = useState<NiwaMessage[]>([]);
  const [work, setWork] = useState<ChatWork | undefined>();
  const [attachments, setAttachments] = useState<string[]>([]);
  const [viewedDiff, setViewedDiff] = useState<string | null>(null);
  const [focusedFile, setFocusedFile] = useState<string | undefined>();
  const transcript = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [diff, setDiff] = useState('');
  const [showDiff, setShowDiff] = useState(true);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [approvals, setApprovals] = useState<NiwaApproval[]>([]);
  const [connector, setConnector] = useState('');
  const voice = useRef<NiwaVoice | null>(null);
  const tail = useRef<HTMLDivElement>(null);
  const session = useRef<'idle' | 'starting' | 'active' | 'stopping'>('idle');
  const sessionVersion = useRef(0);
  const talkSources = useRef(new Set<'shortcut' | 'pointer' | 'keyboard'>());
  const muteMicrophone = () => {
    const muted = voice.current?.setMicrophoneEnabled(false);
    // Capture stops synchronously; dictation can claim it before React renders.
    releaseMicrophone();
    void muted?.catch(error => setError(String(error)));
  };
  const act = async (work: () => Promise<unknown>) => { try { setError(''); await work(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } };
  const refresh = async () => {
    const next = await window.localflow.niwaSnapshot(); setSnapshot(next); setDiff(next.diff || ''); setMessages(next.messages); setActivities(next.activities || []); setWork(next.work); setBusy(next.busy); setApprovals(next.approvals); onMode(next.settings.voiceMode);
  };
  useEffect(() => {
    const element = footer.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      element.parentElement?.style.setProperty('--chat-footer-height', `${element.offsetHeight}px`);
      if (followTail.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    voice.current = new NiwaVoice(message => {
      if (talkSources.current.size) { talkSources.current.clear(); muteMicrophone(); }
      setError(message);
    }, active => { setMicrophoneActive(active); onListening(active); });
    void act(refresh);
    const unsubscribe = window.localflow.onNiwaEvent(event => {
      if (event.type === 'conversation') { setInput(''); setAttachments([]); setViewedDiff(null); setFocusedFile(undefined); setActivities([]); followTail.current = true; void act(refresh); }
      if (event.type === 'projects') void act(async () => { const projects = await window.localflow.niwaProjects(); setSnapshot(current => current && { ...current, projects }); });
      if (event.type === 'work') setWork(event.work);
      if (event.activity) setActivities(current => [...current.filter(item => item.id !== event.activity!.id), event.activity!]);
      if (event.type === 'message' && event.id) setMessages(current => [...current.filter(message => message.id !== event.id), { id: event.id!, role: event.role!, content: event.content!, timestamp: event.timestamp!, turnId: event.turnId, work: event.work }]);
      if (event.type === 'delta') setMessages(current => {
        const found = current.some(message => message.id === event.id);
        return found ? current.map(message => message.id === event.id ? { ...message, content: message.content + event.text } : message) : [...current, { id: event.id!, role: 'assistant', content: event.text!, timestamp: Date.now(), turnId: event.turnId }];
      });
      if (event.type === 'diff') { setDiff(event.diff || ''); setViewedDiff(null); setFocusedFile(undefined); }
      if (event.type === 'busy') setBusy(event.busy!);
      if (event.type === 'settings' && event.settings) setSnapshot(current => current && { ...current, settings: event.settings! });
      if (event.type === 'error') setError(event.message!);
      if (event.type === 'sdp') void act(() => voice.current!.answer(event.sdp!));
      if (event.type === 'voice') {
        if (event.active && session.current === 'stopping') return;
        // A previous session may finish stopping while its replacement negotiates.
        // Failure to start the replacement is handled by its rejected start promise.
        if (!event.active && session.current === 'starting') return;
        setStarting(false); setVoiceActive(event.active!); onVoiceActive(event.active!);
        session.current = event.active ? 'active' : session.current === 'stopping' ? 'stopping' : 'idle';
        if (!event.active) { sessionVersion.current++; talkSources.current.clear(); voice.current?.close(); releaseMicrophone(); }
      }
      if (event.type === 'approval') setApprovals(current => [...current, { id: event.id!, title: event.title!, detail: event.detail, questions: event.questions }]);
      if (event.type === 'approval-resolved') setApprovals(current => current.filter(item => item.id !== event.id));
    });
    return () => { unsubscribe(); voice.current?.close(); releaseMicrophone(); };
  }, []);
  useEffect(() => { if (visible && followTail.current) tail.current?.scrollIntoView({ block: 'nearest' }); }, [messages, visible, work, diff]);
  const beginTalk = async () => {
    if (session.current === 'stopping') { talkSources.current.clear(); return; }
    if (microphoneBusy || !claimMicrophone()) { talkSources.current.clear(); setError('Finish the current dictation before opening Niwa’s microphone.'); return; }
    const needsStart = session.current === 'idle';
    if (needsStart) {
      session.current = 'starting'; sessionVersion.current++;
      setError(''); setStarting(true); onVoiceActive(true);
    }
    const version = sessionVersion.current;
    try {
      await voice.current!.setMicrophoneEnabled(true);
      if (needsStart && version === sessionVersion.current) await voice.current!.start();
    } catch (error) {
      if (version !== sessionVersion.current) return;
      talkSources.current.clear();
      muteMicrophone();
      if (needsStart) { session.current = 'idle'; setStarting(false); setVoiceActive(false); onVoiceActive(false); }
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const setTalkHeld = (source: 'shortcut' | 'pointer' | 'keyboard', held: boolean) => {
    if (held === talkSources.current.has(source)) return;
    if (held) talkSources.current.add(source); else talkSources.current.delete(source);
    if (talkSources.current.size) void beginTalk();
    else muteMicrophone();
  };
  const talkHandler = useRef(setTalkHeld);
  talkHandler.current = setTalkHeld;
  const realtime = snapshot?.settings.voiceMode !== 'local';
  const realtimeRef = useRef(realtime);
  realtimeRef.current = realtime;
  useEffect(() => window.localflow.onDictationHotkey(payload => {
    if (payload.action === 'niwa-agent' && realtimeRef.current) talkHandler.current('shortcut', payload.event === 'pressed');
  }), []);
  useEffect(() => {
    const releaseButton = () => { talkHandler.current('pointer', false); talkHandler.current('keyboard', false); };
    window.addEventListener('blur', releaseButton);
    return () => window.removeEventListener('blur', releaseButton);
  }, []);
  useEffect(() => {
    if (!visible) { talkHandler.current('pointer', false); talkHandler.current('keyboard', false); }
  }, [visible]);
  const endVoice = async () => {
    session.current = 'stopping'; sessionVersion.current++; talkSources.current.clear();
    voice.current?.close(); releaseMicrophone(); setStarting(false); setVoiceActive(false); onVoiceActive(false);
    await act(() => window.localflow.niwaStopVoice());
    session.current = 'idle';
  };
  const configure = async (patch: Partial<NiwaSettings>) => act(async () => {
    const settings = await window.localflow.niwaConfigure(patch); setSnapshot(current => current && { ...current, settings }); onMode(settings.voiceMode);
  });
  const send = () => act(async () => { const text = [input.trim(), attachments.length ? `Attached local files:\n${attachments.map(path => JSON.stringify(path)).join('\n')}` : ''].filter(Boolean).join('\n\n'); if (!text) return; followTail.current = true; await window.localflow.niwaSend(text); setInput(''); setAttachments([]); });
  const active = voiceActive || starting || recording;
  const listening = microphoneActive || recording;
  const viewChanges = (patch: string, file?: string) => { setViewedDiff(patch); setFocusedFile(file); setShowDiff(true); };
  const lastAssistantId = messages.filter(message => message.role === 'assistant').at(-1)?.id;
  const currentChat = snapshot?.projects?.chats.find(chat => chat.id === snapshot.projects?.activeId);
  return <>{sidebar && visible && snapshot?.projects && <ProjectSidebar target={sidebar} projects={snapshot.projects} disabled={active || busy} run={act} />}<section className={`niwaPage ${showDiff ? 'withDiff' : ''}`} hidden={!visible}>
    <div className="niwaConversation">
    <header className="niwaToolbar"><div className="agentChatTab"><MessageCircle size={14} /><strong className="agentChatTitle">{currentChat?.label || 'Niwa'}</strong></div><button className="newChatButton" aria-label="New chat" title="New chat" disabled={active || busy} onClick={() => void act(async () => { if (currentChat) await window.localflow.niwaNewChat(currentChat.folderId); else { const folder = await window.localflow.niwaAddProject(); if (folder) await window.localflow.niwaOpenFolder(folder.id); } })}><Plus size={17} /></button><span className={`niwaPresence ${listening ? 'live' : ''}`}>{listening ? 'Listening' : busy ? 'Working' : starting ? 'Connecting…' : voiceActive ? 'Mic off' : ''}</span><button onClick={() => setShowDiff(current => !current)} aria-label="Toggle changes" aria-pressed={showDiff} title="Changes"><PanelRight size={17} /></button></header>
    <details className="niwaConfiguration"><summary aria-label="Agent settings" title="Agent settings"><Settings2 size={16} /></summary><div className="niwaConfigurationContent">
      <button onClick={() => void act(async () => { const value = await window.localflow.niwaConnect(); setSnapshot(current => current && { ...current, ...value }); })}>Connect Codex / refresh models</button>
      {snapshot && <div className="niwaSettingsGrid">
        <label>Conversation<select value={snapshot.settings.voiceMode} disabled={active || busy} onChange={event => void configure({ voiceMode: event.target.value as NiwaSettings['voiceMode'] })}><option value="realtime">Codex duplex voice</option><option value="local">Local transcription + voice model</option></select></label>

      </div>}
      <BrowserConnection disabled={active || busy} />
      <details><summary>MCP connectors</summary><textarea aria-label="MCP connector configuration" value={connector} onChange={event => setConnector(event.target.value)} /><button disabled={active || busy} onClick={() => void act(async () => { const connectors = await window.localflow.niwaSaveConnector(JSON.parse(connector)); setSnapshot(current => current && { ...current, connectors }); })}>Save connector</button>{snapshot?.connectors.map(item => <p key={item.id}>{item.id} · {item.transport} · {item.enabled ? 'enabled' : 'disabled'}</p>)}</details>
      <details onToggle={event => { if (event.currentTarget.open) void act(async () => { const next = await window.localflow.niwaSnapshot(); setSnapshot(next); }); }}><summary>Private memory ({snapshot?.memory.active_facts || 0})</summary>{Object.values(snapshot?.memory.documents || {}).flat().map(fact => <div className="niwaFact" key={fact.id}><span>{fact.fact}</span><button onClick={() => void act(async () => { const memory = await window.localflow.niwaForget(fact.id); setSnapshot(current => current && { ...current, memory }); })}>Forget</button></div>)}</details>
    </div></details>
    <div className="niwaTranscript" ref={transcript} aria-live="polite" onScroll={() => { const element = transcript.current; if (element) followTail.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; }}>
      {!messages.length && <div className="niwaEmpty"><Asterisk size={36} /><h3>What shall we work on?</h3></div>}
      {messages.map(message => <article className={`niwaBubble ${message.role}`} key={message.id}>
        {message.work && <WorkDetails work={message.work} />}
        <MarkdownContent content={message.content} />
        {message.role === 'assistant' && <>
          <ChangesCard diff={message.work?.diff || (message.id === lastAssistantId && !message.work ? diff : '')} canUndo={!busy && !active && snapshot?.settings.access !== 'read' && (!message.work || message.work.diff === diff)} onView={file => viewChanges(message.work?.diff || diff, file)} onUndo={() => act(() => window.localflow.niwaUndoChanges(message.work?.diff || diff))} />
          <MessageActions content={message.content} />
        </>}
      </article>)}
      {busy && <WorkDetails busy work={work || { startedAt: Date.now(), activities, diff }} />}
      {!busy && !work && activities.length > 0 && <details className="chatWork"><summary>Activity</summary><div className="agentActivities">{activities.map(item => <details key={item.id} className="agentActivity"><summary><span>{item.title}</span><small>{item.status}</small></summary><pre>{item.content}</pre></details>)}</div></details>}
      <div ref={tail} />
    </div>
    <div className="niwaChatFooter" ref={footer}>
    {approvals.map(approval => <Approval key={approval.id} approval={approval} respond={answer => void act(() => window.localflow.niwaRespond(approval.id, answer))} />)}
    {error && <div className="errorBox" role="alert">{error}</div>}
    <AgentComposer input={input} setInput={setInput} attachments={attachments} setAttachments={setAttachments} snapshot={snapshot} disabled={active || busy} busy={busy} configure={configure}
      connect={() => void act(async () => { const value = await window.localflow.niwaConnect(); setSnapshot(current => current && { ...current, ...value }); })}
      send={() => void send()} interrupt={() => void act(() => window.localflow.niwaInterrupt())}
      attach={() => void act(async () => { const paths = await window.localflow.niwaSelectFiles(); setAttachments(current => [...new Set([...current, ...paths])]); })}
      voiceControls={<div className="niwaVoiceBar">{realtime && <button className="composerDictate" title={recording ? 'Stop local recording' : 'Dictate with local voice'} aria-label={recording ? 'Stop local recording' : 'Dictate with local voice'} disabled={microphoneBusy && !recording} onClick={onLocalRecord}>{recording ? <Square size={14} /> : <Mic size={15} />}</button>}<button className={`niwaTalk ${listening ? 'live' : ''}`} aria-label={realtime ? 'Hold to talk to Niwa' : recording ? 'Stop local recording' : 'Talk with local voice'} title={realtime ? `Hold to talk · ${shortcutLabel}` : 'Talk with local voice'} aria-pressed={listening}
      onClick={() => { if (!realtime) onLocalRecord(); }}
      onPointerDown={event => { if (realtime && event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); setTalkHeld('pointer', true); } }}
      onPointerUp={() => setTalkHeld('pointer', false)} onPointerCancel={() => setTalkHeld('pointer', false)} onLostPointerCapture={() => setTalkHeld('pointer', false)}
      onKeyDown={event => { if (realtime && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); if (!event.repeat) setTalkHeld('keyboard', true); } }}
      onKeyUp={event => { if (realtime && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); setTalkHeld('keyboard', false); } }}
      onBlur={() => setTalkHeld('keyboard', false)} disabled={microphoneBusy && !recording}>
      {listening ? <Square size={15} /> : realtime ? <AudioLines size={18} /> : <Mic size={17} />}</button>
      {realtime && (voiceActive || starting) && <button className="endVoiceButton" title="End voice" aria-label="End voice" onClick={() => void endVoice()}><Square size={13} /><span className="srOnly">End voice</span></button>}
    </div>} />
    </div>
    </div>
    {showDiff && <AgentDiff diff={viewedDiff ?? diff} focusedFile={focusedFile} onClose={() => setShowDiff(false)} />}
  </section></>;
}

function Approval({ approval, respond }: { approval: NiwaApproval; respond: (answer: unknown) => void }) {
  const [answers, setAnswers] = useState<Record<string, { answers: string[] }>>({});
  return <div className="niwaApproval"><strong>{approval.title}</strong>{approval.detail && <pre>{approval.detail}</pre>}
    {approval.questions?.map(question => <label key={question.id}>{question.question}<input list={`answers-${question.id}`} onChange={event => setAnswers(current => ({ ...current, [question.id]: { answers: [event.target.value] } }))} /><datalist id={`answers-${question.id}`}>{question.options?.map(option => <option key={option.label} value={option.label}>{option.description}</option>)}</datalist></label>)}
    <div><button onClick={() => respond(approval.questions ? answers : true)}>{approval.questions ? 'Reply' : 'Allow once'}</button><button onClick={() => respond(false)}>Decline</button></div>
  </div>;
}
