import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createNotesService } from '../host/notes-service.mjs';
import { createMeetingStore } from '../host/meetings/store.mjs';
import { createMeetingNotes } from '../host/meetings/notes.mjs';
import { validateMeetingSummary } from '../host/meetings/summary.mjs';

const directory=process.argv[2];
if(!directory)throw new Error('An isolated fixture profile is required.');
const store=createMeetingStore(directory), notes=createNotesService(directory,()=>{}), settings={};
const chunk={id:'microphone-0',source:'microphone',index:0,startMs:0,endMs:1_440_000,status:'done'};
const session={id:'00000000-aaaa-aaaa-aaaa-000000000003',title:'Pilot launch and account setup',application:'Google Meet',startedAt:Date.parse('2026-10-07T10:00:00Z'),endedAt:Date.parse('2026-10-07T10:24:00Z'),elapsedMs:1_440_000,state:'completed',summaryState:'ready',errors:[],chunks:[chunk],audioRetained:false};
const speech=[
  'Mina will prepare the prototype by Friday.',
  'We agreed to test the desktop recorder before starting the mobile app.',
  'Google sign-in should connect the profile and Calendar in one flow.',
  'We still need to choose the public account service domain.',
  'Remote access will require the home computer to be awake.',
];
store.save(session);
store.completeChunk(session,chunk,{language:'en',segments:Array.from({length:240},(_,index)=>({start:index*6,end:index*6+5,text:speech[index] || (index===151 ? 'Завршна провера 日本語 العربية: the final review stays open.' : `Synthetic transcript passage ${index+1}. We discussed the pilot recording workflow.`)}))});
const transcript=store.transcript(session), point=(text,index)=>({text,evidence:[transcript[index].id]});
const summary=validateMeetingSummary({title:session.title,language:'en',labels:{overview:'Meeting overview',topics:'Topics',keyPoints:'Key points',decisions:'Decisions',actions:'Action items',openQuestions:'Open questions',nextSteps:'Next steps',transcript:'Transcript',microphone:'Microphone',remote:'Remote audio',owner:'Owner',dueDate:'Due'},
  actions:[{...point('Prepare the recording prototype',0),owner:'Mina',dueDate:'Friday',ownerQuote:speech[0],dueQuote:speech[0]}],
  overview:[point('The pilot starts with desktop recording and one Google account connection.',1)],keyPoints:[],
  topics:[{title:'Desktop pilot',points:[point('Validate the desktop recorder before work begins on a mobile application.',1)]},{title:'Google account and Calendar',points:[point('Connect the profile and Calendar in the same sign-in flow.',2)]},{title:'Access from another device',points:[point('Remote Notes require the home computer to remain awake.',4)]}],
  decisions:[point('Test desktop recording first.',1)],openQuestions:[point('Choose the public account service domain.',3),point('Complete the final multilingual review.',151)],nextSteps:[]},transcript);
store.saveSummary(session.id,summary);
try {
  const writer=createMeetingNotes({notes,store,settings,persistSettings:()=>store.saveSettings(settings)});
  await writer.sync(session,transcript,summary);
  writeFileSync(join(directory,'meeting-ui-fixture.json'),JSON.stringify({id:session.id,noteId:session.noteId}));
}finally{await notes.close();}
