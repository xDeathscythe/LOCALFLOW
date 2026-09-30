import { ArrowRight, ArrowUpRight, AudioLines, ChevronDown, Clipboard, FileDown, Globe, Mic, NotebookPen, Plus, RotateCcw, Sparkles, Square, Upload } from "lucide-react";
import { Waveform } from "./Waveform";
import type { CleanupLevel, TranscriptResult, TranscriptionLanguage } from "../types";

export type RecentSession = { id: string; name: string; path: string; createdAt: number; result: TranscriptResult };
type Props = {
  result: TranscriptResult | null; name: string; state: string; status: string; error: string;
  seconds: number; stream: MediaStream | null; visible: boolean; busy: boolean; hasAudio: boolean;
  model: string; language: TranscriptionLanguage; cleanup: CleanupLevel; shortcut: string; hold: boolean;
  sessions: RecentSession[];
  onLanguage: (language: TranscriptionLanguage) => void; onCleanup: (level: CleanupLevel) => void;
  onRecord: () => void; onStop: () => void; onReset: () => void; onImport: () => void; onRetry: () => void;
  onCopy: (text?: string) => void; onExport: (text: string | undefined, name: string) => void;
  onSaveNote: () => void; onHistory: () => void; onOpenSession: (session: RecentSession) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
};
const duration = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const words = (text = "") => Array.from(segmenter.segment(text)).filter(part => part.isWordLike).length;

export function TranscribePage(p: Props) {
  const recording = p.state === "recording";
  const locked = recording || p.busy;
  const raw = p.result?.rawText;
  const clean = p.result?.polishedText;
  return <section className="transcribeView" onDrop={p.onDrop} onDragOver={event => event.preventDefault()} aria-label="Transcription workspace">
    <header className="flowHeading">
      <div><h1>Transcribe</h1></div>
      <button className="flowPill" data-action="new-session" onClick={p.onReset} disabled={locked}><Plus size={16} />New session</button>
    </header>
    <div className="flowSessionToolbar">
      <span className="flowSessionName"><AudioLines size={15} /><span>{p.name}</span></span>
      <label className="flowSelect"><Globe size={13} />
        <select aria-label="Transcription language" value={p.language} disabled={locked} onChange={e => p.onLanguage(e.target.value as TranscriptionLanguage)}>
          <option value="auto">Auto detect</option><option value="sr">Serbian</option><option value="en">English</option>
        </select><ChevronDown size={12} />
      </label>
    </div>
    <div className="transcriptGrid">
      <article className="textPane">
        <div className="paneHeader"><h2>Original transcript</h2><div className="paneActions">
          <button aria-label="Copy raw transcript" title="Copy original" onClick={() => p.onCopy(raw)} disabled={!raw}><Clipboard size={16} /></button>
          <button aria-label="Save raw transcript" title="Download original" onClick={() => p.onExport(raw, "localflow-raw-transcript.txt")} disabled={!raw}><FileDown size={16} /></button>
        </div></div>
        <textarea aria-label="Original transcript" readOnly value={raw || ""} placeholder="Your words will appear here. Record a thought or import an audio file." />
        <footer><span>{words(raw)} words</span><span>Original wording</span></footer>
      </article>
      <article className="textPane">
        <div className="paneHeader"><h2><Sparkles size={14} />Refined text</h2>
          <label className="flowSelect"><select aria-label="Cleanup level" value={p.cleanup} disabled={locked} onChange={e => p.onCleanup(e.target.value as CleanupLevel)}>
            <option value="none">Cleanup off</option><option value="light">Light cleanup</option><option value="medium">Medium cleanup</option><option value="high">High cleanup</option>
          </select><ChevronDown size={12} /></label>
        </div>
        {clean && p.cleanup !== "none" ? <textarea aria-label="Refined transcript" readOnly value={clean} /> : <div className="flowEmpty">
          <span><Sparkles size={20} /></span><h3>{p.cleanup === "none" ? "Your words, untouched." : "A little more clarity."}</h3>
          <p>{p.cleanup === "none" ? "Cleanup is off. Your original transcript is ready to use." : p.state === "processing" ? "Your transcript is being prepared…" : "Your refined transcript will appear here after recording."}</p>
        </div>}
        <footer><span>{p.cleanup === "none" ? "No AI processing" : clean ? "Meaning preserved" : "Ready when you are"}</span>
          <button className="flowTextButton" onClick={() => p.onCopy(clean)} disabled={!clean || p.cleanup === "none"}><Clipboard size={12} />Copy text</button>
        </footer>
      </article>
    </div>
    <div className="recordingDock">
      <div className="recordingInfo"><span className="microphoneBadge"><Mic size={18} /></span><div>
        <strong>{recording ? "Listening…" : p.state === "idle" ? "Ready when you are" : p.status}</strong>
        <small>{p.hold ? "Hold" : "Press"} <kbd>{p.shortcut}</kbd> to speak</small>
      </div></div>
      <Waveform stream={p.stream} recording={recording} visible={p.visible} />
      <div className="recordingAction"><time>{duration(p.seconds)}</time>
        {recording ? <button className="recordButton stop" onClick={p.onStop} aria-label="Stop and transcribe"><Square size={15} fill="currentColor" />Stop</button>
          : <button className="recordButton" onClick={p.onRecord} disabled={p.busy} aria-label="Record"><Mic size={16} />Record</button>}
      </div>
    </div>
    <div className="underDock"><span><i className="onlineDot" />{p.model}<i className="flowSeparator">/</i>On-device transcription</span><div>
      {p.hasAudio && <button className="flowTextButton" onClick={p.onRetry} disabled={locked} aria-label="Transcribe again"><RotateCcw size={12} />Retry</button>}
      <button className="flowTextButton" data-action="import" onClick={p.onImport} disabled={locked}><Upload size={12} />Import audio</button>
      <button className="flowTextButton" data-action="save-note" onClick={p.onSaveNote} disabled={!raw && !clean}><NotebookPen size={12} />Save to notes</button>
    </div></div>
    {p.error && <div className="errorBox" role="alert">{p.error}</div>}
    <section className="recentSessions"><header><h2>Recent recordings</h2><button className="flowTextButton" onClick={p.onHistory}>View history<ArrowRight size={13} /></button></header>
      <div className="recentGrid">{p.sessions.slice(0, 2).map(session => <button className="recentCard" key={session.id} onClick={() => p.onOpenSession(session)} disabled={locked}>
        <span className="sessionSymbol"><AudioLines size={16} /></span><span><strong>{session.name}</strong><small>{new Date(session.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}<span>{duration(session.result.duration || 0)}</span></small></span><ArrowUpRight size={14} />
      </button>)}</div>
      {!p.sessions.length && <p className="recentEmpty">Your recent recordings will appear here.</p>}
    </section>
  </section>;
}
