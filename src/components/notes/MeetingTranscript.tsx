import { useEffect, useMemo, useState } from 'react';
import { AudioLines, ChevronLeft, ChevronRight, Copy, Download, Mic, Search } from 'lucide-react';
import { meetingTimestamp, type MeetingDetail } from '../../lib/meetings';

export function MeetingTranscript({ detail, target }: { detail:MeetingDetail; target:string }) {
  const [query,setQuery] = useState(''), [page,setPage] = useState(0), [notice,setNotice] = useState('');
  const segments = detail.transcript, labels = detail.summary?.labels;
  const filtered = useMemo(() => segments.filter(segment => segment.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())),[segments,query]);
  const pages = Math.max(1,Math.ceil(filtered.length / 100)), currentPage = Math.min(page,pages-1);
  useEffect(() => {
    if (!target) return;
    const index = segments.findIndex(segment => segment.id === target);
    if (index >= 0) { setQuery(''); setPage(Math.floor(index / 100)); }
  },[target]);
  useEffect(() => {
    if (!target) return;
    document.getElementById(`meeting-line-${target}`)?.scrollIntoView({block:'center',behavior:'instant'});
  },[target,currentPage,query]);
  const exportTranscript = async (copy:boolean) => {
    try {
      const text = segments.map(segment => `${meetingTimestamp(segment.startMs)} · ${labels?.[segment.source] || (segment.source === 'microphone' ? 'Microphone' : 'Remote audio')}\n${segment.text}`).join('\n\n');
      if (copy) { await window.localflow.copyText(text); setNotice('Transcript copied'); }
      else { await window.localflow.exportText({text,defaultName:`meeting-${detail.session.id}.txt`}); setNotice(''); }
    } catch (error) { setNotice(String(error)); }
  };
  return <section className="meetingTranscript" aria-label="Full meeting transcript">
    <div className="meetingTranscriptTools"><label><Search size={15} /><input aria-label="Search full transcript" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search transcript" /></label><button title="Copy full transcript" aria-label="Copy full transcript" onClick={() => void exportTranscript(true)}><Copy size={15}/></button><button title="Export full transcript" aria-label="Export full transcript" onClick={() => void exportTranscript(false)}><Download size={15}/></button></div>
    <p className="meetingTranscriptHint">Original speech recognition output. Channels identify the microphone and call audio, not individual people.</p>
    {notice && <p className="meetingTranscriptHint" role="status">{notice}</p>}
    {!filtered.length && <p className="meetingTranscriptHint">{segments.length ? 'No matching text.' : 'No speech has been transcribed yet.'}</p>}
    {filtered.slice(currentPage * 100,(currentPage + 1) * 100).map(segment => <article id={`meeting-line-${segment.id}`} key={segment.id} data-highlighted={segment.id === target}>
      <header><time>{meetingTimestamp(segment.startMs)}</time><span>{segment.source === 'microphone' ? <Mic size={13}/> : <AudioLines size={13}/>} {labels?.[segment.source] || (segment.source === 'microphone' ? 'Microphone' : 'Remote audio')}</span></header><p dir="auto">{segment.text}</p>
    </article>)}
    {pages > 1 && <nav className="meetingTranscriptPages" aria-label="Transcript pages"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15}/>Previous</button><span>{currentPage + 1} / {pages}</span><button disabled={currentPage === pages-1} onClick={() => setPage(currentPage + 1)}>Next<ChevronRight size={15}/></button></nav>}
  </section>;
}
