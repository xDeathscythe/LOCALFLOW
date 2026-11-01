export type MeetingSession = {
  id: string; noteId?: string; title: string; application?: string; callId?: string;
  startedAt: number; endedAt?: number; elapsedMs: number; muted: boolean;
  state: 'starting' | 'recording' | 'paused' | 'stopping' | 'processing' | 'completed' | 'interrupted' | 'error';
  processId: number; loopbackMode: 'process' | 'system'; microphoneDeviceId?: string;
  chunkCount: number; processedChunks: number; pendingChunks: number; failedChunks: number;
  summaryState: 'waiting' | 'pending' | 'running' | 'ready' | 'error' | 'empty';
  summaryError?: string; noteError?: string; errors: string[]; preservedEdits?: boolean;
  callEnded?: boolean; captureFailed?: boolean;
  sources?: { source:'microphone'|'remote'; available:boolean; error?:string; echoCancellation?:string }[];
};
export type MeetingOffer = { id: string; callId: string; processId?: number; microphoneDeviceId?: string; application?: string; title?: string; kind: 'manual' | 'calendar' | 'call'; confirmedCall: boolean; createdAt: number };
export type MeetingSources = {
  supported: boolean; processLoopback?: boolean; warnings?: string[];
  devices: { id: string; label: string; source: 'microphone' | 'remote'; default: boolean }[];
  sessions: { processId: number; application: string; source: string; active?: boolean; [key: string]: unknown }[];
  candidates: { processId: number; application: string; [key: string]: unknown }[];
};
export type MeetingState = {
  active: MeetingSession | null; offer: MeetingOffer | null; sessions: MeetingSession[];
  settings: { automaticOffers: boolean; retainAudio: boolean; summaryLanguage: string; folderId?: string };
  capabilities: MeetingSources | null; candidates: MeetingSources['candidates']; errors: { sessionId?: string; message: string }[];
  browser?: { listening:boolean; paired:boolean; lastSeenAt:number|null; error:string|null } | null;
};
export type MeetingEvent = ({ type: 'meeting-state' } & MeetingState) | { type: 'meeting-open-note'; noteId: string };
export type MeetingPoint = { text:string; evidence:string[] };
export type MeetingSummary = {
  title:string; language:string; labels:Record<string,string>;
  overview:MeetingPoint[]; keyPoints:MeetingPoint[]; decisions:MeetingPoint[]; openQuestions:MeetingPoint[]; nextSteps:MeetingPoint[];
  actions:(MeetingPoint & {owner:string|null;dueDate:string|null})[];
  topics?:{title:string;points:MeetingPoint[]}[];
};
export type MeetingSegment = { id:string; source:'microphone'|'remote'; text:string; startMs:number; endMs:number };
export type MeetingDetail = { session:MeetingSession; summary:MeetingSummary|null; transcript:MeetingSegment[]; actionStatus:boolean[] };
export const meetingTimestamp = (milliseconds:number) => {
  const seconds = Math.max(0,Math.floor(milliseconds / 1000));
  return [Math.floor(seconds / 3600),Math.floor(seconds / 60) % 60,seconds % 60].map(value => String(value).padStart(2,'0')).join(':');
};
export const meetingDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
