import { useEffect, useState } from 'react';
import { Check, Copy, FolderOpen, RefreshCw } from 'lucide-react';
import type { MeetingState } from '../lib/meetings';

export function MeetingBrowserSettings({ status }: { status:MeetingState['browser'] }) {
  const [browser, setBrowser] = useState(status), [pair, setPair] = useState<{code:string;expiresAt:number}|null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  useEffect(() => { setBrowser(status); }, [status]);
  const refresh = async () => setBrowser(await window.localflow.meetingCall<MeetingState['browser']>('browser-status'));
  useEffect(() => {
    if (!pair) return;
    const timer = setInterval(() => {
      if (pair.expiresAt <= Date.now()) { setPair(null); return; }
      void window.localflow.meetingCall<MeetingState['browser']>('browser-status').then(next => {
        setBrowser(next); if (next?.paired) setPair(null);
      }).catch(error => setError(String(error)));
    }, 3000);
    return () => clearInterval(timer);
  }, [pair]);
  const run = async (action:() => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section className="meetingBrowser" aria-label="Browser call detection">
    <header><h2>Browser call detection</h2><span>{browser?.paired ? <><Check size={14} />Connected</> : 'Optional'}</span></header>
    <p className="meetingHint">The Chrome / Edge extension can offer transcription for connected Meet, Zoom, Teams and WhatsApp web calls. Voice messages do not trigger an offer. It sends call activity, never audio or message text.</p>
    <details><summary>Set up the browser extension</summary><ol>
      <li>Open your browser’s Extensions page, enable Developer mode and choose Load unpacked. Select the LocalFlow Meeting Detection folder.</li>
      <li>Create a connection code below. Paste it into the LocalFlow extension and choose Connect.</li>
      <li>Reload existing meeting tabs. A call offer still needs your confirmation before recording starts.</li>
    </ol><div className="meetingActions">
      <button disabled={busy} onClick={() => void run(() => window.localflow.meetingCall('browser-folder'))}><FolderOpen size={15} />Show extension folder</button>
      <button disabled={busy || !browser?.listening || browser.paired} onClick={() => void run(async () => { setPair(await window.localflow.meetingCall('browser-pair')); setCopied(false); })}>Create connection code</button>
    </div></details>
    {pair && <div className="meetingPair"><label>Connection code<input readOnly value={pair.code} onFocus={event => event.target.select()} /></label><button disabled={busy} onClick={() => void run(async () => { await window.localflow.copyText(pair.code); setCopied(true); })}><Copy size={15} />{copied ? 'Copied' : 'Copy'}</button><small>Expires at {new Date(pair.expiresAt).toLocaleTimeString()}.</small></div>}
    <div className="meetingActions"><button disabled={busy} onClick={() => void run(refresh)}><RefreshCw size={14} />Refresh connection</button>{browser?.paired && <button disabled={busy} onClick={() => void run(async () => { await window.localflow.meetingCall('browser-disconnect'); setPair(null); await refresh(); })}>Disconnect extension</button>}</div>
    {(error || browser?.error) && <p className="errorBox" role="alert">{error || browser?.error}</p>}
  </section>;
}
