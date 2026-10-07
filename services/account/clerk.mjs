import { createClerkClient } from '@clerk/backend';

export function createClerkProvider({ secretKey, publishableKey, origin, fetchImpl = fetch }) {
  if (!secretKey || !publishableKey) throw new Error('Configure the LocalFlow Clerk keys on the account service.');
  const clerk = createClerkClient({ secretKey, publishableKey });
  return {
    async authenticate(request) {
      const result = await clerk.authenticateRequest(request, { authorizedParties: [origin], acceptsToken: 'session_token' });
      const auth = result.toAuth();
      if (!auth?.userId || !auth.sessionId) throw Object.assign(new Error('Sign in to LocalFlow again.'), { status: 401 });
      const session = await clerk.sessions.getSession(auth.sessionId);
      if (session.status !== 'active' || session.userId !== auth.userId) throw Object.assign(new Error('Session was revoked.'), { status: 401 });
      const user = await clerk.users.getUser(auth.userId);
      if (user.banned || user.locked) throw Object.assign(new Error('Account is unavailable.'), { status: 403 });
      return { id: user.id, name: [user.firstName, user.lastName].filter(Boolean).join(' '), email: user.emailAddresses.find(item => item.id === user.primaryEmailAddressId)?.emailAddress || '' };
    },
    async calendar(userId, resource, query) {
      const { data } = await clerk.users.getUserOauthAccessToken(userId, 'google');
      const grant = data[0];
      const required = resource === 'list' ? 'https://www.googleapis.com/auth/calendar.calendarlist.readonly' : 'https://www.googleapis.com/auth/calendar.events.readonly';
      if (!grant?.token || !grant.scopes?.includes(required)) throw Object.assign(new Error('Google Calendar permission is missing. Reconnect Google from your account.'), { status: 403 });
      const path = resource === 'list' ? 'users/me/calendarList' : `calendars/${encodeURIComponent(query.calendarId)}/events`;
      const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
      url.searchParams.set('maxResults', resource === 'list' ? '250' : '1000');
      for (const key of resource === 'list' ? ['pageToken'] : ['syncToken', 'pageToken']) if (query[key]) url.searchParams.set(key, query[key]);
      if (resource !== 'list') { url.searchParams.set('singleEvents', 'true'); url.searchParams.set('showDeleted', 'true'); }
      if (resource !== 'list' && !query.syncToken) { url.searchParams.set('timeMin', query.timeMin); url.searchParams.set('timeMax', query.timeMax); }
      const response = await fetchImpl(url, { headers: { authorization: `Bearer ${grant.token}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw Object.assign(new Error(response.status === 410 ? 'Calendar sync needs a fresh snapshot.' : response.status === 401 || response.status === 403 ? 'Google Calendar access needs to be renewed.' : 'Google Calendar is temporarily unavailable.'), { status: response.status });
      const value = await response.json();
      // Provider tokens and unrelated Google profile fields never reach desktop clients.
      const items = (value.items || []).map(item => resource === 'list'
        ? { id: item.id, summary: item.summary, primary: Boolean(item.primary), timeZone: item.timeZone, accessRole: item.accessRole }
        : { id: item.id, status: item.status, summary: item.summary, start: item.start, end: item.end, updated: item.updated, recurringEventId: item.recurringEventId, originalStartTime: item.originalStartTime, hangoutLink: item.hangoutLink, conferenceData: item.conferenceData, attendees: item.attendees?.map(({ email, displayName, self, responseStatus }) => ({ email, displayName, self, responseStatus })) });
      return { items, nextPageToken: value.nextPageToken, nextSyncToken: value.nextSyncToken };
    },
  };
}
