import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from '../niwa/host/niwa-store.mjs';

export function createCalendarCache({ directory, request, changed = () => {} }) {
  const file = join(directory, 'account', 'calendar.json');
  let data = readJsonFile(file, { ownerId: '', selected: [], calendars: [], entries: {}, enabled: true }), pending;
  let status = 'idle', error = '';
  const save = () => { writeJsonFile(file, data); changed(); };
  const pages = async (path, query = {}) => {
    let pageToken, syncToken, items = [], count = 0;
    do {
      const page = await request(path, { ...query, ...(pageToken ? { pageToken } : {}) });
      items.push(...(page.items || [])); pageToken = page.nextPageToken; syncToken = page.nextSyncToken;
      if (++count > 1000) throw new Error('Calendar response exceeded the local cache limit.');
    } while (pageToken);
    return { items, syncToken };
  };
  const sync = () => {
    if (pending) return pending;
    pending = (async () => {
      if (!data.enabled || !data.ownerId) return;
      const owner = data;
      status = 'syncing'; error = ''; changed();
      try {
        const { items: calendars } = await pages('/v1/calendar/list');
        if (data !== owner) return;
        data.calendars = calendars;
        if (!data.initialized) { data.selected = calendars.filter(item => item.primary).map(item => item.id); data.initialized = true; }
        const available = new Set(calendars.map(item => item.id)); data.selected = data.selected.filter(id => available.has(id));
        for (const calendarId of data.selected) {
          const previous = data.entries[calendarId];
          // Refresh the bounded recurrence window daily; incremental tokens handle edits in between.
          const syncToken = previous?.syncedAt > Date.now() - 86_400_000 ? previous.syncToken : undefined;
          const fullQuery = { calendarId, timeMin: new Date(Date.now() - 30 * 86_400_000).toISOString(), timeMax: new Date(Date.now() + 180 * 86_400_000).toISOString() };
          let result, full = !syncToken;
          try { result = await pages('/v1/calendar/events', syncToken ? { calendarId, syncToken } : fullQuery); }
          catch (failure) { if (failure.status !== 410) throw failure; full = true; result = await pages('/v1/calendar/events', fullQuery); }
          if (data !== owner) return;
          const events = new Map((full ? [] : previous.items).map(event => [event.id, event]));
          for (const event of result.items) event.status === 'cancelled' ? events.delete(event.id) : events.set(event.id, event);
          data.entries[calendarId] = { items: [...events.values()], syncToken: result.syncToken, syncedAt: full ? Date.now() : previous.syncedAt };
        }
        for (const calendarId of Object.keys(data.entries)) if (!data.selected.includes(calendarId)) delete data.entries[calendarId];
        data.lastSync = new Date().toISOString(); status = 'ready'; save();
      } catch (failure) { if (data !== owner) return; status = failure.status === 401 || failure.status === 403 ? 'permission-required' : 'offline'; error = failure.message; changed(); }
    })().finally(() => { pending = null; });
    return pending;
  };
  return {
    bind(ownerId) { if (data.ownerId !== ownerId) { data = { ownerId, selected: [], calendars: [], entries: {}, enabled: true }; status = 'idle'; error = ''; save(); } },
    clear() { data = { ownerId: '', selected: [], calendars: [], entries: {}, enabled: true }; status = 'idle'; error = ''; save(); },
    state: () => ({ status, error, enabled: data.enabled, calendars: data.calendars, selected: data.selected, lastSync: data.lastSync }),
    async select(ids) { if (!Array.isArray(ids) || ids.length > 30 || ids.some(id => !data.calendars.some(item => item.id === id))) throw new Error('Choose available Google calendars.'); data.selected = [...new Set(ids)]; save(); await sync(); },
    async enable(enabled) { data.enabled = Boolean(enabled); save(); if (data.enabled) await sync(); },
    events(now = Date.now()) { return data.enabled ? data.selected.flatMap(calendarId => (data.entries[calendarId]?.items || []).filter(event => event.start?.dateTime && event.end?.dateTime && Date.parse(event.end.dateTime) > now - 300_000 && Date.parse(event.start.dateTime) < now + 86_400_000).map(event => ({ ...event, calendarId }))).sort((a, b) => Date.parse(a.start.dateTime) - Date.parse(b.start.dateTime)) : []; },
    sync,
  };
}
