import assert from 'node:assert/strict';
import { meetingCalendarEvents } from '../host/meetings/calendar-events.mjs';
const meeting = { id:'same-id',calendarId:'work',summary:'打ち合わせ العربية',start:{dateTime:'2026-10-07T13:00:00+02:00'},end:{dateTime:'2026-10-07T14:00:00+02:00'},conferenceData:{conferenceId:'abc-defg-hij'} };
const events = meetingCalendarEvents([meeting,{...meeting,calendarId:'personal'},{...meeting,status:'cancelled'},{...meeting,start:{date:'2026-10-07'}},{...meeting,attendees:[{self:true,responseStatus:'declined'}]},{...meeting,conferenceData:null},{...meeting,conferenceData:null,attendees:[{self:false,responseStatus:'accepted'}]}]);
assert.equal(events.length,3);
assert.notEqual(events[0].id,events[1].id);
assert.equal(events[0].title,meeting.summary);
assert.equal(events[0].startMs,Date.parse('2026-10-07T11:00:00Z'));
console.log('MEETING_CALENDAR_BRIDGE_OK');
