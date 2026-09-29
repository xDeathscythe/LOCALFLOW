import { useEffect, useState } from 'react';

export function ModelSettings({ visible, disabled, onModel }: { visible: boolean; disabled: boolean; onModel: (model: string) => void }) {
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [model, setModel] = useState('');
  const [voices, setVoices] = useState<string[]>([]);
  const [voice, setVoice] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void Promise.all([window.localflow.getCleanupModels(), window.localflow.niwaSnapshot()]).then(([cleanup, agent]) => {
      if (cancelled) return;
      setModels(cleanup.models); setModel(cleanup.selected); onModel(cleanup.selected);
      setVoices(agent.voices); setVoice(agent.settings.voice); setVoiceBusy(agent.voice); setAgentBusy(agent.busy); setError(cleanup.error);
    }).catch(error => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, [visible]);
  useEffect(() => window.localflow.onNiwaEvent(event => {
    if (event.type === 'voice') setVoiceBusy(Boolean(event.active));
    if (event.type === 'busy') setAgentBusy(Boolean(event.busy));
    if (event.type === 'settings' && event.settings) setVoice(event.settings.voice);
  }), []);
  const save = async (work: () => Promise<void>) => {
    setSaving(true); setError('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  return <div className="settingsGroup">
    <div className="settingsGroupHeading"><strong>Cleanup model & Live1 voice</strong><span>Changes apply to the next cleanup or voice conversation.</span></div>
    <div className="niwaSettingsGrid">
      <label>Cleanup model<select aria-label="Cleanup model" value={model} disabled={disabled || saving || !models.length} onChange={event => {
        const value = event.target.value;
        void save(async () => { const selected = await window.localflow.setCleanupModel(value); setModel(selected); onModel(selected); });
      }}>{models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Live1 voice<select aria-label="Live1 voice" value={voice} disabled={saving || voiceBusy || agentBusy || !voices.length} onChange={event => {
        const value = event.target.value;
        void save(async () => { const settings = await window.localflow.niwaConfigure({ voice: value }); setVoice(settings.voice); });
      }}>{voices.map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
    </div>
    {model === 'gpt-live-1-codex' && <p>Live1 cleans your transcript through a separate, silent connection. Your Niwa conversation stays available.</p>}
    {(voiceBusy || agentBusy) && <p>End the current voice conversation and wait for Niwa to finish before changing its voice.</p>}
    {error && <p className="errorBox" role="alert">{error}</p>}
  </div>;
}
