import { useEffect, useState } from 'react';
import { CalendarDays, Check, Cloud, LogOut, Monitor, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AccountSettingsProps, AccountState } from './AccountSettings.types';
import './AccountSettings.css';
export type { AccountState, AccountSettingsProps } from './AccountSettings.types';

export function AccountSettings({ call, onState }: AccountSettingsProps) {
  const [state, setState] = useState<AccountState | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [service, setService] = useState(''), [executable, setExecutable] = useState('');
  useEffect(() => {
    let active = true;
    void call('status').then(value => { if (active) { const next = value as AccountState; setState(next); setService(next.serviceUrl); setExecutable(next.remote.cloudflaredPath); } }).catch(failure => { if (active) setError(failure.message); });
    const unsubscribe = onState?.(next => { if (active) setState(next); });
    return () => { active = false; unsubscribe?.(); };
  }, [call, onState]);
  const run = async (action: string, value?: Record<string, unknown>) => {
    setBusy(action); setError('');
    try { setState(await call(action, value) as AccountState); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(''); }
  };
  if (!state) return <section className="accountSettings settingsBlock" aria-busy="true"><h3>Account & connections</h3>{error ? <p role="alert">{error}</p> : <p>Loading account settings…</p>}</section>;
  const disabled = Boolean(busy), signedIn = Boolean(state.user);
  return <section className="accountSettings settingsBlock" aria-label="Account and connections" aria-busy={disabled}>
    <div className="accountHeading"><div><h3>Account & connections</h3><p>One Google connection for your profile and meeting calendar.</p></div><ShieldCheck size={22} aria-hidden="true" /></div>
    <div className="accountIdentity"><div><strong>{state.user?.name || state.user?.email || 'Your LocalFlow account'}</strong><p>{state.user?.email || 'Local dictation and Notes work without an account.'}</p></div>
      {signedIn ? <button disabled={disabled} onClick={() => void run('logout')}><LogOut size={15} /> Sign out</button> : <button className="accountPrimary" disabled={disabled || !state.configured || state.status === 'connecting'} onClick={() => void run('login')}>Continue with Google</button>}
    </div>
    {state.status === 'connecting' && <p role="status">Complete Google sign-in in your browser. <button disabled={disabled} onClick={() => void run('cancelLogin')}>Cancel</button></p>}
    {state.status === 'sign-in-required' && <button disabled={disabled} onClick={() => void run('login')}>Reconnect Google</button>}
    {!state.configured && <p className="accountHint">The LocalFlow account service has not been configured for this build. Add its HTTPS address below to enable Google sign-in.</p>}
    {signedIn && <>
      <div className="accountSectionHeading"><h4><CalendarDays size={17} /> Meeting calendar</h4><button disabled={disabled} onClick={() => void run('calendarSync')} aria-label="Refresh calendar"><RefreshCw size={15} /></button></div>
      <label className="accountToggle"><input type="checkbox" checked={state.calendar.enabled} disabled={disabled} onChange={event => void run('calendarEnable', { enabled: event.target.checked })} /> Use calendar for meeting reminders</label>
      {state.calendar.calendars.map(calendar => <label className="accountToggle" key={calendar.id}><input type="checkbox" checked={state.calendar.selected.includes(calendar.id)} disabled={disabled || !state.calendar.enabled} onChange={event => void run('calendarSelect', { ids: event.target.checked ? [...state.calendar.selected, calendar.id] : state.calendar.selected.filter(id => id !== calendar.id) })} /><span>{calendar.summary}{calendar.primary ? ' · Primary' : ''}</span></label>)}
      {state.calendar.status === 'permission-required' && <p>Calendar permission needs to be renewed. <button disabled={disabled} onClick={() => void run('login')}>Reconnect Google</button></p>}
      {state.calendar.error && <p className="accountError" role="status">{state.calendar.error}</p>}
      {!!state.upcoming.length && <ul className="accountUpcoming">{state.upcoming.slice(0, 4).map(event => <li key={`${event.calendarId}:${event.id}`}><span>{event.summary || 'Scheduled meeting'}</span><time dateTime={event.start.dateTime}>{new Date(event.start.dateTime).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>)}</ul>}
      <div className="accountSectionHeading"><h4><Cloud size={17} /> Remote Notes</h4><span className={state.remote.status === 'online' ? 'accountOnline' : ''}>{state.remote.status === 'online' && <Check size={13} />}{state.remote.status}</span></div>
      <label className="accountToggle"><input type="checkbox" checked={state.remote.enabled} disabled={disabled} onChange={event => void run(event.target.checked ? 'remoteEnable' : 'remoteDisable')} /> Allow my signed-in devices to access Notes on this computer</label>
      <p className="accountHint">Your computer must be awake and LocalFlow running. Devices are checked on every request. Mobile apps will connect to this same workspace.</p>
      {state.remote.error && <p className="accountError" role="alert">{state.remote.error}</p>}
      <div className="accountSectionHeading"><h4><Monitor size={17} /> Computers & devices</h4><button disabled={disabled} onClick={() => void run('refresh')} aria-label="Refresh devices"><RefreshCw size={15} /></button></div>
      <ul className="accountDevices">{state.computers.map(computer => <li key={computer.id}><span>{computer.name}{computer.id === state.hostId ? ' · This computer' : ''}</span><span>{computer.online ? 'Online' : 'Offline'}</span></li>)}{state.devices.filter(device => !device.revoked && !device.current).map(device => <li key={device.id}><span>{device.name}</span><button disabled={disabled} onClick={() => void run('revokeDevice', { deviceId: device.id })}>Revoke access</button></li>)}</ul>
    </>}
    <details className="accountSetup"><summary>Connection setup</summary><label>Account service<input type="url" value={service} placeholder="https://accounts.example.com" disabled={disabled || signedIn} onChange={event => setService(event.target.value)} /></label><label>cloudflared executable <span>(optional)</span><input value={executable} placeholder="Use installed cloudflared" disabled={disabled} onChange={event => setExecutable(event.target.value)} /></label><button disabled={disabled} onClick={() => void run('configure', { serviceUrl: service.trim(), cloudflaredPath: executable.trim() })}>Save connection settings</button></details>
    {(error || state.error) && <p className="accountError" role="alert">{error || state.error}</p>}
  </section>;
}
