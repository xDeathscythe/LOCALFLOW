// Calendar labels are content. Only structured event fields decide whether to offer a meeting.
export function meetingCalendarEvents(events = []) {
  return events.flatMap(event => {
    const startMs = Date.parse(event.start?.dateTime), endMs = Date.parse(event.end?.dateTime);
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    if (!event.id || event.status === 'cancelled' || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || attendees.some(person => person.self && person.responseStatus === 'declined')) return [];
    const conferenceId = event.conferenceData?.conferenceId;
    if (!conferenceId && !event.hangoutLink && !attendees.some(person => !person.self && !person.resource && person.responseStatus !== 'declined')) return [];
    return [{ id:`${event.calendarId || 'primary'}:${event.id}`, calendarId:event.calendarId, title:event.summary || '', startMs, endMs, conferenceId }];
  });
}
