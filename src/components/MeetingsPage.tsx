import { useEffect, useState } from 'react';
import { AudioLines, Check, Clock3, FileText, Mic, MicOff, Pause, Play, RefreshCw, Square, X } from 'lucide-react';
import { meetingDuration, type MeetingSession, type MeetingSources, type MeetingState } from '../lib/meetings';
import { MeetingBrowserSettings } from './MeetingBrowserSettings';
import '../styles/meetings.css';

function SessionClock({ session }: { session: MeetingSession }) {
  const [received, setReceived] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setReceived(Date.now()); setNow(Date.now()); }, [session.elapsedMs, session.state]);
  useEffect(() => {
    if (session.state !== 'recording') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session.state]);
  return <time>{meetingDuration(session.elapsedMs + (session.state === 'recording' ? now - received : 0))}</time>;
}

const stateLabels: Record<MeetingSession['state'], string> = { starting:'Starting capture', recording:'Recording', paused:'Paused', stopping:'Saving audio', processing:'Transcribing', completed:'Saved', interrupted:'Interrupted', error:'Needs attention' };

export function MeetingsPage() {
  const [state, setState] = useState<MeetingState | null>(null);
  const [sources, setSources] = useState<MeetingSources | null>(null);
  const [processId, setProcessId] = useState('');
  const [microphone, setMicrophone] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refreshSources = async () => {
    const next = await window.localflow.meetingCall<MeetingSources>('sources');
    setSources(next);
    setProcessId(current => current || (next.candidates.length === 1 ? String(next.candidates[0].processId) : ''));
  };
  useEffect(() => {
    let live = true;
    const off = window.localflow.onMeetingEvent(event => { if (live && event.type === 'meeting-state') setState(event); });
    void window.localflow.meetingCall('status').then(value => { if (live) setState(value); }).catch(error => { if (live) setError(String(error)); });
    void refreshSources().catch(error => { if (live) setError(String(error)); });
    return () => { live = false; off(); };
  }, []);
  useEffect(() => {
    if (state?.offer?.processId) setProcessId(String(state.offer.processId));
    if (state?.offer?.microphoneDeviceId) setMicrophone(state.offer.microphoneDeviceId);
  }, [state?.offer?.id]);
  const run = async (method: string, value?: unknown) => {
    setBusy(true); setError('');
    try {
      await window.localflow.meetingCall(method, value);
      setState(await window.localflow.meetingCall('status'));
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const active = state?.active;
  const applications = [...new Map([...(sources?.sessions || []), ...(state?.offer?.processId ? [{processId:state.offer.processId,application:state.offer.application || `Application ${state.offer.processId}`}] : [])].map(session => [session.processId, session])).values()];
  const source = { processId:processId === 'system' ? 0 : Number(processId), loopbackMode:processId === 'system' ? 'system' : 'process', microphoneDeviceId:microphone || undefined, application:applications.find(item => item.processId === Number(processId))?.application, ...(title.trim() ? {title:title.trim()} : {}) };
  const canStart = Boolean(processId) && sources?.supported && (processId === 'system' || sources?.processLoopback !== false) && !busy;
  return <section className="meetingsPage">
    <header className="meetingHeading"><div><span className="meetingEyebrow">LOCAL RECORDING</span><h1>Meetings</h1><p>Your voice, their voice, one complete note.</p></div><AudioLines size={30} aria-hidden="true" /></header>
    {error && <div className="errorBox" role="alert">{error}</div>}
    {state?.errors.map((failure, index) => <div key={index} className="errorBox" role="alert">{failure.message}</div>)}
    {active ? <section className="meetingCaptureCard" aria-label="Active meeting">
      <div className="meetingCaptureTitle"><span className={`meetingStatusDot ${active.state}`} /><div><h2>{active.title}</h2><p>{stateLabels[active.state]}{active.application ? ` · ${active.application}` : ''}</p></div><SessionClock session={active} /></div>
      <div className="meetingChannels"><span>{active.muted ? <MicOff size={15} /> : <Mic size={15} />}{active.muted ? 'Your microphone is muted' : 'Your microphone'}</span><span><AudioLines size={15} />{active.loopbackMode === 'system' ? 'All computer audio' : 'Call application audio'}</span></div>
      {active.errors?.map((message, index) => <div key={index} className="errorBox" role="alert">{message}</div>)}
      {active.sources?.filter(source => !source.available).map(source => <div key={source.source} className="errorBox" role="alert">{source.source === 'microphone' ? 'Microphone' : 'Call audio'} is unavailable. {source.error || 'Reconnecting…'}</div>)}
      {active.sources?.some(source => source.source === 'microphone' && source.echoCancellation === 'unavailable') && <p className="meetingHint">Use headphones to keep call audio out of the microphone recording; this microphone has no echo cancellation.</p>}
      <div className="meetingActions">
        {['recording','paused'].includes(active.state) && <>
          <button disabled={busy} onClick={() => void run(active.state === 'paused' ? 'resume' : 'pause')}>{active.state === 'paused' ? <Play size={16} /> : <Pause size={16} />}{active.state === 'paused' ? 'Resume' : 'Pause'}</button>
          <button disabled={busy} aria-pressed={active.muted} onClick={() => void run('mute', {muted:!active.muted})}>{active.muted ? <Mic size={16} /> : <MicOff size={16} />}{active.muted ? 'Unmute microphone' : 'Mute microphone'}</button>
          <button className="meetingStop" disabled={busy} onClick={() => void run('stop')}><Square size={14} fill="currentColor" />Finish meeting</button>
        </>}
        {active.state === 'error' && <button className="meetingStop" disabled={busy} onClick={() => void run('stop')}>Retry stopping capture</button>}
        {active.noteId && <button disabled={busy} onClick={() => void run('open-note',{id:active.id})}><FileText size={16} />Open note</button>}
      </div>
      <p className="meetingHint">{active.processedChunks} of {active.chunkCount} audio parts transcribed{active.pendingChunks ? ` · ${active.pendingChunks} waiting` : ''}. Audio is saved while transcription catches up.</p>
    </section> : <section className="meetingCaptureCard">
      {state?.offer && <div className="meetingOffer"><AudioLines size={20} /><div><strong>{state.offer.title || 'Transcribe meeting?'}</strong><span>{state.offer.application || (state.offer.kind === 'calendar' ? 'Scheduled meeting' : 'Choose the call audio below')}</span></div><button aria-label="Dismiss meeting offer" disabled={busy} onClick={() => void run('decline')}><X size={17} /></button></div>}
      <div className="meetingSourceGrid">
        <label>Meeting title <span>Optional</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="AI will name the meeting" maxLength={160} /></label>
        <label>Call audio<div className="meetingSourceRow"><select value={processId} onChange={event => setProcessId(event.target.value)} aria-label="Call audio"><option value="">Choose an application</option>{applications.map(session => <option key={session.processId} value={session.processId}>{session.application || `Application ${session.processId}`}</option>)}<option value="system">All computer audio</option></select><button aria-label="Refresh audio sources" disabled={busy} onClick={() => { setError(''); void refreshSources().catch(error => setError(String(error))); }}><RefreshCw size={15} /></button></div></label>
        <label>Microphone<select value={microphone} onChange={event => setMicrophone(event.target.value)} aria-label="Meeting microphone"><option value="">Default communications microphone</option>{sources?.devices.filter(device => device.source === 'microphone').map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label>
      </div>
      <p className="meetingHint">Recording starts when you confirm. Let everyone in the call know. Muting your call app does not mute this recorder.</p>
      {processId === 'system' && <p className="meetingHint">This source includes other apps and notifications playing on your computer.</p>}
      {sources?.processLoopback === false && processId !== 'system' && <p className="meetingHint">Application audio capture is unavailable on this computer. Choose All computer audio to record the call.</p>}
      {processId && processId !== 'system' && <p className="meetingHint">Application audio includes all of its windows or browser tabs.</p>}
      <div className="meetingActions"><button className="meetingPrimary" disabled={!canStart} onClick={() => void run(state?.offer ? 'accept' : 'start',source)}><Check size={18} />Transcribe meeting</button><span className="meetingPrivacy">Audio is recorded and transcribed on this computer.</span></div>
      {sources?.warnings?.map((message, index) => <p className="meetingHint" key={index}>{message}</p>)}
    </section>}
    <section className="meetingPreferences" aria-label="Meeting preferences">
      <label><input type="checkbox" checked={state?.settings.automaticOffers ?? true} disabled={busy || !state} onChange={event => void run('configure',{automaticOffers:event.target.checked})} /><span>Offer to transcribe detected calls<small>Microphone activity alone does not open the notch.</small></span></label>
      <label><input type="checkbox" checked={state?.settings.retainAudio ?? false} disabled={busy || !state} onChange={event => void run('configure',{retainAudio:event.target.checked})} /><span>Keep audio after transcription<small>Transcripts and meeting notes are always saved.</small></span></label>
      <label className="meetingLanguage">Summary language code<input aria-label="Meeting summary language" placeholder="auto, sr, en, ja…" defaultValue={state?.settings.summaryLanguage || 'auto'} key={state?.settings.summaryLanguage} maxLength={80} disabled={busy || !state} onBlur={event => { const language = event.target.value.trim() || 'auto'; if (language !== state?.settings.summaryLanguage) void run('configure',{summaryLanguage:language}); }} /><small>Use auto to follow the conversation’s language.</small></label>
      <p className="meetingHint">AI summaries send transcript text to your connected Codex service. Without a connection, the transcript is kept and the summary can be retried.</p>
    </section>
    <MeetingBrowserSettings status={state?.browser} />
    <section className="meetingHistory"><header><h2>Saved meetings</h2><span>Notes / Meetings</span></header>
      {!state?.sessions.length && <div className="meetingEmpty"><FileText size={26} /><p>Your first meeting note will appear here.</p></div>}
      {state?.sessions.filter(session => session.id !== active?.id).map(session => <article key={session.id}>
        <FileText size={21} /><div className="meetingHistoryText"><strong>{session.title}</strong><small><Clock3 size={12} />{new Date(session.startedAt).toLocaleString()} · {meetingDuration(session.elapsedMs)} · {stateLabels[session.state]}</small>{session.errors?.slice(-2).map((message,index) => <p key={index}>{message}</p>)}{session.summaryError && <p>{session.summaryError}</p>}{session.noteError && <p>{session.noteError}</p>}{session.preservedEdits && <p>Your edits were preserved.</p>}</div>
        <div className="meetingHistoryActions">{session.noteId && <button onClick={() => void run('open-note',{id:session.id})} disabled={busy}>Open note</button>}{(session.noteError || session.summaryState !== 'ready' && session.summaryState !== 'empty') && <button onClick={() => void run('retry',{id:session.id})} disabled={busy} aria-label={`Retry ${session.title}`}><RefreshCw size={14} />Retry</button>}</div>
      </article>)}
    </section>
  </section>;
}
