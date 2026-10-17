import { CalendarDays, Settings } from 'lucide-react';
import { useAccount } from '../lib/use-account';
import './MeetingCalendar.css';

export function MeetingCalendar({ onAccount }: { onAccount: () => void }) {
  const { account, error } = useAccount();
  return <section className="meetingCalendar" aria-label="Google Calendar">
    <header><h2><CalendarDays size={17} /> Meeting calendar</h2><button onClick={onAccount}><Settings size={14} />{account?.user ? 'Manage calendar' : 'Connect Google'}</button></header>
    {error ? <p role="alert">{error}</p> : !account ? <p>Loading calendar…</p> : !account.user ? <p>Sign in to LocalFlow to see your Google meetings and prepare their notes.</p> : !account.calendar.available ? <p>Your profile is connected. Calendar access needs to be configured on the LocalFlow service.</p> : !account.calendar.enabled ? <p>Calendar reminders are turned off.</p> : account.calendar.error ? <p role="status">{account.calendar.error}</p> : account.upcoming.length ? <ul>{account.upcoming.map(event => <li key={`${event.calendarId}:${event.id}`}><time dateTime={event.start.dateTime}>{new Date(event.start.dateTime).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</time><strong>{event.summary || 'Scheduled meeting'}</strong></li>)}</ul> : <p>{account.calendar.status === 'syncing' ? 'Updating your calendar…' : 'No meetings scheduled in the next 24 hours.'}</p>}
  </section>;
}
