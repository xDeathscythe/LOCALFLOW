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
  return <details className="meetingBrowser">
    <summary>Browser extension{browser?.paired && <span><Check size={14} />Connected</span>}</summary>
    <ol>
      <li>In Chrome or Edge extensions, enable Developer mode and load the extension folder below.</li>
      <li>Create a connection code and paste it into the extension.</li>
      <li>Reload your meeting tabs.</li>
    </ol><div className="meetingActions">
      <button disabled={busy} onClick={() => void run(() => window.localflow.meetingCall('browser-folder'))}><FolderOpen size={15} />Show extension folder</button>
      <button disabled={busy || !browser?.listening || browser.paired} onClick={() => void run(async () => { setPair(await window.localflow.meetingCall('browser-pair')); setCopied(false); })}>Create connection code</button>
    </div>
    {pair && <div className="meetingPair"><label>Connection code<input readOnly value={pair.code} onFocus={event => event.target.select()} /></label><button disabled={busy} onClick={() => void run(async () => { await window.localflow.copyText(pair.code); setCopied(true); })}><Copy size={15} />{copied ? 'Copied' : 'Copy'}</button><small>Expires at {new Date(pair.expiresAt).toLocaleTimeString()}.</small></div>}
    <div className="meetingActions"><button disabled={busy} onClick={() => void run(refresh)}><RefreshCw size={14} />Refresh connection</button>{browser?.paired && <button disabled={busy} onClick={() => void run(async () => { await window.localflow.meetingCall('browser-disconnect'); setPair(null); await refresh(); })}>Disconnect extension</button>}</div>
    {(error || browser?.error) && <p className="errorBox" role="alert">{error || browser?.error}</p>}
  </details>;
}
