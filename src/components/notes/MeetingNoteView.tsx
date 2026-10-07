import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AudioLines, CalendarDays, FileText, ListChecks, Pencil } from 'lucide-react';
import { meetingDuration, type MeetingDetail, type MeetingPoint } from '../../lib/meetings';
import { MeetingTranscript } from './MeetingTranscript';
import '../../styles/meeting-note.css';

type Props = { noteId:string; revision:unknown; visible:boolean; editable:boolean; blockTarget:string; editorRequest:{id:string;sequence:number}|null; beforeChange:() => Promise<void>; children:ReactNode };
export function MeetingNoteView({ noteId,revision,visible,editable,blockTarget,editorRequest,beforeChange,children }:Props) {
  const [detail,setDetail] = useState<MeetingDetail|null|undefined>(), [view,setView] = useState<'summary'|'transcript'|'notes'>('summary');
  const [target,setTarget] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let live=true, timer:ReturnType<typeof setTimeout>;
    const refresh = () => { void window.localflow.meetingCall<MeetingDetail|null>('read-note',{noteId}).then(value => { if(live)setDetail(value); }).catch(failure => { if(live){setError(String(failure));setDetail(null);} }); };
    refresh();
    let previous='';
    const off=window.localflow.onMeetingEvent(event => {
      if(event.type!=='meeting-state')return;
      const session=event.sessions.find(session => session.noteId===noteId);
      const next=session ? `${session.processedChunks}:${session.summaryState}:${session.state}` : '';
      if(next!==previous){previous=next;clearTimeout(timer);timer=setTimeout(refresh,150);}
    });
    return () => {live=false;clearTimeout(timer);off();};
  },[noteId,revision,visible]);
  useEffect(() => {if(editorRequest?.id===noteId)setView('notes');},[editorRequest]);
  useEffect(() => {
    if(blockTarget.startsWith('block-meeting-segment-')){setTarget(blockTarget.slice('block-meeting-segment-'.length));setView('transcript');}
  },[blockTarget]);
  const numbers = useMemo(() => new Map(detail?.transcript.map((segment,index) => [segment.id,index+1]) || []),[detail?.transcript]);
  const select = async (next:typeof view) => {
    setBusy(true);setError('');
    try {await beforeChange();setView(next);}catch(error){setError(String(error));}finally{setBusy(false);}
  };
  const evidence = (ids:string[]) => <span className="meetingEvidence">{ids.map(id => <button key={id} aria-label={`Read transcript source ${numbers.get(id) || ''}`} title="Read this part of the conversation" onClick={() => {setTarget(id);void select('transcript');}}>{numbers.get(id) || '↗'}</button>)}</span>;
  const points = (items:MeetingPoint[]) => <ul>{items.map((point,index) => <li key={index}><span dir="auto">{point.text}</span> {evidence(point.evidence)}</li>)}</ul>;
  if(detail===null)return <>{error && <p className="meetingNoteNotice" role="status">Meeting view could not load. The saved note is available below.</p>}{children}</>;
  if(!detail)return view==='notes' ? children : <p className="meetingNoteNotice">Loading meeting…</p>;
  const summary=detail.summary, labels=summary?.labels || {};
  const sections = [
    {title:labels.overview || 'Meeting overview',items:summary?.overview || []},
    ...(summary?.topics?.map(topic => ({title:topic.title,items:topic.points})) || []),
    ...(!summary?.topics?.length ? [{title:labels.keyPoints || 'Key points',items:summary?.keyPoints || []}] : []),
    {title:labels.decisions || 'Decisions',items:summary?.decisions || []},
    {title:labels.openQuestions || 'Open questions',items:summary?.openQuestions || []},
    {title:labels.nextSteps || 'Next steps',items:summary?.nextSteps || []},
  ].filter(section => section.items.length);
  const checkAction = async (index:number,checked:boolean) => {
    setBusy(true);setError('');
    try {
      await beforeChange();
      setDetail(await window.localflow.meetingCall<MeetingDetail>('action-check',{id:detail.session.id,index,text:summary!.actions[index].text,checked}));
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };
  return <div className="meetingNoteView">
    <div className="meetingNoteCard">
      <header className="meetingNoteMeta"><CalendarDays size={17}/><time>{new Date(detail.session.startedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time><span>{meetingDuration(detail.session.elapsedMs)}</span>{detail.session.application && <span>{detail.session.application}</span>}</header>
      <nav className="meetingNoteTabs" aria-label="Meeting views">
        <button aria-pressed={view==='summary'} disabled={busy} onClick={() => void select('summary')}><ListChecks size={15}/>Summary</button>
        <button aria-pressed={view==='transcript'} disabled={busy} onClick={() => void select('transcript')}><AudioLines size={15}/>Full transcript <small>{detail.transcript.length}</small></button>
        <button aria-pressed={view==='notes'} disabled={busy} onClick={() => void select('notes')}><Pencil size={14}/>{editable ? 'Edit note' : 'Saved note'}</button>
      </nav>
      {error && <p className="errorBox" role="alert">{error}</p>}
      {detail.session.noteError && <p className="errorBox" role="alert">{detail.session.noteError}</p>}
      {view==='summary' && <div className="meetingSummaryContent">
        {summary ? <>
          {!!summary.actions.length && <section><h2 dir="auto">{labels.actions || 'Action items'}</h2><ul className="meetingActionItems">{summary.actions.map((action,index) => <li key={index}><label><input type="checkbox" aria-label={action.text} checked={detail.actionStatus?.[index] || false} disabled={busy || !editable} onChange={event => void checkAction(index,event.target.checked)}/><span dir="auto">{action.text}{(action.owner || action.dueDate) && <small>{[action.owner,action.dueDate].filter(Boolean).join(' · ')}</small>}</span></label>{evidence(action.evidence)}</li>)}</ul></section>}
          {sections.map((section,index) => <section key={index}><h2 dir="auto">{section.title}</h2>{points(section.items)}</section>)}
        </> : <div className="meetingSummaryWaiting"><FileText size={26}/><h2>{['recording','paused'].includes(detail.session.state) ? 'Meeting in progress' : detail.session.summaryState==='empty' ? 'No speech was captured' : 'Preparing the meeting summary'}</h2><p>{detail.transcript.length ? 'Your full transcript is saved. The summary will appear here after processing.' : 'The transcript will appear as audio is processed.'}</p>{detail.session.summaryError && <p>{detail.session.summaryError}</p>}{detail.session.errors.map((message,index) => <p key={index}>{message}</p>)}</div>}
        {detail.session.preservedEdits && <p className="meetingNoteNotice">Your manual changes are preserved in Edit note.</p>}
      </div>}
      {view==='transcript' && <MeetingTranscript detail={detail} target={target}/>}
    </div>
    {view==='notes' && children}
  </div>;
}
