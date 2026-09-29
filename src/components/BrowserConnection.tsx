import { useEffect, useState } from 'react';

export function BrowserConnection({ disabled = false }: { disabled?: boolean }) {
  const [browser, setBrowser] = useState({ mode: 'bundled', connected: false });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => { void window.localflow.niwaSnapshot().then(value => setBrowser(value.browser)).catch(error => setError(String(error))); };
    refresh(); window.addEventListener('focus', refresh); window.addEventListener('localflow-browser-change', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('localflow-browser-change', refresh); };
  }, []);
  const change = async (connect: boolean) => {
    setConnecting(true); setError('');
    try { setBrowser(await (connect ? window.localflow.niwaConnectBrowser() : window.localflow.niwaDisconnectBrowser())); window.dispatchEvent(new Event('localflow-browser-change')); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setConnecting(false); }
  };
  return <div className="settingsGroup niwaBrowserConnection">
    <div className="settingsGroupHeading"><strong>{browser?.connected ? 'Chrome connected' : 'Browser connection'}</strong><span>Use your Chrome tabs and signed-in accounts, or LocalFlow’s bundled browser.</span></div>
    <p>On the first connection, enable remote debugging in the Chrome page that opens and approve Chrome’s connection request.</p>
    <div className="utilityActions">
      <button disabled={disabled || connecting} onClick={() => void change(true)}>{connecting ? 'Waiting for Chrome…' : 'Connect browser'}</button>
      {browser?.mode === 'chrome' && <button disabled={disabled || connecting} onClick={() => void change(false)}>Disconnect · use bundled browser</button>}
    </div>
    {error && <p role="alert" className="errorBox">{error}</p>}
  </div>;
}
