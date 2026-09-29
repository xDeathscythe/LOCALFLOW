import { useEffect, useRef, useState } from 'react';
import { Asterisk, Mic, Send, Square, Settings2 } from 'lucide-react';
import { NiwaVoice, type NiwaApproval, type NiwaMessage, type NiwaSettings, type NiwaSnapshot } from '../lib/niwa';
import { BrowserConnection } from './BrowserConnection';

export function NiwaAgent({ visible, shortcutLabel, recording, microphoneBusy, claimMicrophone, releaseMicrophone, onLocalRecord, onVoiceActive, onMode }: {
  visible: boolean; shortcutLabel: string; recording: boolean; microphoneBusy: boolean; onLocalRecord: () => void; onVoiceActive: (active: boolean) => void; onMode: (mode: string) => void;
  claimMicrophone: () => boolean; releaseMicrophone: () => void;
}) {
  const [snapshot, setSnapshot] = useState<NiwaSnapshot | null>(null);
  const [messages, setMessages] = useState<NiwaMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activity, setActivity] = useState('Ready when you are');
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
    const next = await window.localflow.niwaSnapshot(); setSnapshot(next); setMessages(next.messages); setBusy(next.busy); setApprovals(next.approvals); onMode(next.settings.voiceMode);
  };
  useEffect(() => {
    voice.current = new NiwaVoice(message => {
      if (talkSources.current.size) { talkSources.current.clear(); muteMicrophone(); }
      setError(message);
    }, setMicrophoneActive);
    void act(refresh);
    const unsubscribe = window.localflow.onNiwaEvent(event => {
      if (event.type === 'message' && event.id) setMessages(current => [...current.filter(message => message.id !== event.id), { id: event.id!, role: event.role!, content: event.content!, timestamp: event.timestamp! }]);
      if (event.type === 'delta') setMessages(current => {
        const found = current.some(message => message.id === event.id);
        return found ? current.map(message => message.id === event.id ? { ...message, content: message.content + event.text } : message) : [...current, { id: event.id!, role: 'assistant', content: event.text!, timestamp: Date.now() }];
      });
      if (event.type === 'busy') setBusy(event.busy!);
      if (event.type === 'settings' && event.settings) setSnapshot(current => current && { ...current, settings: event.settings! });
      if (event.type === 'activity') setActivity(event.text!);
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
  useEffect(() => { if (visible) tail.current?.scrollIntoView({ block: 'nearest' }); }, [messages, visible]);
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
  const send = () => act(async () => { const text = input.trim(); if (!text) return; await window.localflow.niwaSend(text); setInput(''); });
  const active = voiceActive || starting || recording;
  const listening = microphoneActive || recording;
  return <section className="utilityPanel niwaPage" hidden={!visible}>
    <header><Asterisk size={28} /><div><h2>Niwa Agent</h2><p>Your voice, your assistant, your memory.</p></div><span className={`niwaPresence ${listening ? 'live' : ''}`}>{listening ? 'Listening' : busy ? 'Working · Mic off' : voiceActive ? 'Mic off' : 'Ready'}</span></header>
    <div className="niwaVoiceBar"><button className={`niwaTalk ${listening ? 'live' : ''}`} aria-label={realtime ? 'Hold to talk to Niwa' : recording ? 'Stop local recording' : 'Talk with local voice'} aria-pressed={listening}
      onClick={() => { if (!realtime) onLocalRecord(); }}
      onPointerDown={event => { if (realtime && event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); setTalkHeld('pointer', true); } }}
      onPointerUp={() => setTalkHeld('pointer', false)} onPointerCancel={() => setTalkHeld('pointer', false)} onLostPointerCapture={() => setTalkHeld('pointer', false)}
      onKeyDown={event => { if (realtime && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); if (!event.repeat) setTalkHeld('keyboard', true); } }}
      onKeyUp={event => { if (realtime && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); setTalkHeld('keyboard', false); } }}
      onBlur={() => setTalkHeld('keyboard', false)} disabled={microphoneBusy && !recording}>
      {listening ? <Square size={20} /> : <Mic size={20} />}{realtime ? listening ? 'Listening… release to mute' : 'Hold to talk' : recording ? 'Stop recording' : 'Talk with local voice'}</button>
      <span>{realtime ? `${starting ? 'Connecting voice… · ' : listening ? 'Microphone on · ' : 'Mic off · '}Hold ${shortcutLabel} to speak` : 'Whisper + your selected local voice'}</span>
      {realtime && active && <button onClick={() => void endVoice()}><Square size={15} /> End voice</button>}
      {busy && <button onClick={() => void act(() => window.localflow.niwaInterrupt())}><Square size={15} /> Stop task</button>}
    </div>
    <details className="niwaConfiguration"><summary><Settings2 size={16} /> Agent settings & tools</summary>
      <button onClick={() => void act(async () => { const value = await window.localflow.niwaConnect(); setSnapshot(current => current && { ...current, ...value }); })}>Connect Codex / refresh models</button>
      {snapshot && <div className="niwaSettingsGrid">
        <label>Conversation<select value={snapshot.settings.voiceMode} disabled={active || busy} onChange={event => void configure({ voiceMode: event.target.value as NiwaSettings['voiceMode'] })}><option value="realtime">Codex duplex voice</option><option value="local">Local transcription + voice model</option></select></label>
        <label>Background model<select value={snapshot.settings.model} disabled={active || busy} onChange={event => void configure({ model: event.target.value })}>{!snapshot.models.length && <option value={snapshot.settings.model}>{snapshot.settings.model || 'Connect to load available models'}</option>}{snapshot.models.map(model => <option key={model.model} value={model.model}>{model.displayName}</option>)}</select></label>
        <label>Reasoning<select value={snapshot.settings.effort} disabled={active || busy} onChange={event => void configure({ effort: event.target.value })}>{(snapshot.models.find(model => model.model === snapshot.settings.model)?.supportedReasoningEfforts || [{ reasoningEffort: snapshot.settings.effort }]).map(item => <option key={item.reasoningEffort}>{item.reasoningEffort}</option>)}</select></label>
        <label>Permissions<select value={snapshot.settings.access} disabled={active || busy} onChange={event => void configure({ access: event.target.value as NiwaSettings['access'] })}><option value="read">Read only</option><option value="workspace">Workspace · ask for computer / external actions</option><option value="full">Full computer access</option></select></label>
        <label className="niwaWorkspace">Workspace<input key={snapshot.settings.cwd} defaultValue={snapshot.settings.cwd} disabled={active || busy} onBlur={event => { if (event.target.value !== snapshot.settings.cwd) void configure({ cwd: event.target.value }); }} /></label>
      </div>}
      <p>Codex tools and subagents · Niwa browser · Windows computer control · MCP connectors · private memory</p>
      <BrowserConnection disabled={active || busy} />
      <details><summary>MCP connectors</summary><textarea aria-label="MCP connector configuration" value={connector} onChange={event => setConnector(event.target.value)} /><button disabled={active || busy} onClick={() => void act(async () => { const connectors = await window.localflow.niwaSaveConnector(JSON.parse(connector)); setSnapshot(current => current && { ...current, connectors }); })}>Save connector</button>{snapshot?.connectors.map(item => <p key={item.id}>{item.id} · {item.transport} · {item.enabled ? 'enabled' : 'disabled'}</p>)}</details>
      <details onToggle={event => { if (event.currentTarget.open) void act(async () => { const next = await window.localflow.niwaSnapshot(); setSnapshot(next); }); }}><summary>Private memory ({snapshot?.memory.active_facts || 0})</summary>{Object.values(snapshot?.memory.documents || {}).flat().map(fact => <div className="niwaFact" key={fact.id}><span>{fact.fact}</span><button onClick={() => void act(async () => { const memory = await window.localflow.niwaForget(fact.id); setSnapshot(current => current && { ...current, memory }); })}>Forget</button></div>)}</details>
    </details>
    <div className="niwaTranscript" aria-live="polite">{!messages.length && <div className="niwaEmpty"><Asterisk size={44} /><h3>Let's talk.</h3><p>Ask a question, make a note, or give Niwa a task on your computer.</p></div>}{messages.map(message => <article className={`niwaBubble ${message.role}`} key={message.id}><small>{message.role === 'user' ? 'You' : 'Niwa'}</small><p>{message.content}</p></article>)}<div ref={tail} /></div>
    {busy && <p className="niwaActivity" role="status">{activity === 'Ready when you are' ? 'Niwa is working…' : activity}</p>}
    {approvals.map(approval => <Approval key={approval.id} approval={approval} respond={answer => void act(() => window.localflow.niwaRespond(approval.id, answer))} />)}
    {error && <div className="errorBox" role="alert">{error}</div>}
    <div className="niwaComposer"><textarea aria-label="Message Niwa" value={input} onChange={event => setInput(event.target.value)} placeholder="Message Niwa…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !event.repeat) void send(); } }} /><button title="Send message" aria-label="Send message" disabled={!input.trim() || busy} onClick={() => void send()}><Send size={20} /></button></div>
  </section>;
}

function Approval({ approval, respond }: { approval: NiwaApproval; respond: (answer: unknown) => void }) {
  const [answers, setAnswers] = useState<Record<string, { answers: string[] }>>({});
  return <div className="niwaApproval"><strong>{approval.title}</strong>{approval.detail && <pre>{approval.detail}</pre>}
    {approval.questions?.map(question => <label key={question.id}>{question.question}<input list={`answers-${question.id}`} onChange={event => setAnswers(current => ({ ...current, [question.id]: { answers: [event.target.value] } }))} /><datalist id={`answers-${question.id}`}>{question.options?.map(option => <option key={option.label} value={option.label}>{option.description}</option>)}</datalist></label>)}
    <div><button onClick={() => respond(approval.questions ? answers : true)}>{approval.questions ? 'Reply' : 'Allow once'}</button><button onClick={() => respond(false)}>Decline</button></div>
  </div>;
}
