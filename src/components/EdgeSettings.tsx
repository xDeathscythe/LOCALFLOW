import { useEffect, useState } from 'react';
export function EdgeSettings() {
  const [settings, setSettings] = useState({ enabled: true, autoHide: true });
  const [error, setError] = useState('');
  useEffect(() => { void window.localflow.getEdgeSettings().then(setSettings).catch(error => setError(error.message)); }, []);
  const update = async (patch: Partial<typeof settings>) => {
    try { setSettings(await window.localflow.setEdgeSettings({ ...settings, ...patch })); setError(''); }
    catch (error) { setError(String(error)); }
  };
  return <div className="edgeSettings settingsBlock"><div><strong>Edge panel</strong><p>Niwa Agent, microphone and Notes at the right edge of your screen.</p></div>
    <label><input type="checkbox" checked={settings.enabled} onChange={event => void update({ enabled: event.target.checked })} /> Enable edge panel</label>
    <label><input type="checkbox" checked={settings.autoHide} disabled={!settings.enabled} onChange={event => void update({ autoHide: event.target.checked })} /> Auto-hide when idle</label>
    <p>{settings.enabled ? 'Reveal with your mouse. Recording, voice and active work keep the panel visible.' : 'The original microphone recording indicator is active.'}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
