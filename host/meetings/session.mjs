import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createMeetingStore } from './store.mjs';
import { createMeetingNotes, meetingActionId } from './notes.mjs';
import { summarizeMeeting } from './summary.mjs';
import { createBrowserBridge } from './browser-bridge.mjs';

const activeStates = new Set(['starting', 'recording', 'paused', 'stopping']);
const finalState = session => session.captureFailed ? 'error' : session.interrupted ? 'interrupted' : 'completed';
const shortText = (value, maximum = 300) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const failureText = error => shortText(error?.message || String(error), 1000);

export async function createMeetingService({ directory, notes, transcription, native, binary, notify = () => {}, getSettings = async () => ({}), summarize = summarizeMeeting }) {
  const store = createMeetingStore(directory);
  const settings = { automaticOffers: true, retainAudio: true, summaryLanguage: 'auto', ...store.readSettings() };
  const persistSettings = () => store.saveSettings(settings);
  const writer = createMeetingNotes({ notes, store, settings, persistSettings });
  let activeId = null, offer = null, capabilities = null, candidates = [], calendarEvents = [], closing = false, browser = null;
  let actions = Promise.resolve(), draining = null, summarizing = null, timer, currentJob = null, summaryAbort = null;
  const suppressed = new Map();
  const active = () => activeId ? store.get(activeId) : null;
  const publicSession = session => {
    const { chunks, directory: privateDirectory, noteCreate, ...value } = session;
    return { ...value, chunkCount: chunks.length, processedChunks: chunks.filter(chunk => chunk.status === 'done').length, pendingChunks: chunks.filter(chunk => ['pending', 'processing'].includes(chunk.status)).length, failedChunks: chunks.filter(chunk => chunk.status === 'error').length };
  };
  const detail = session => {
    const summary = store.readSummary(session.id);
    return { session: publicSession(session), summary, transcript: store.transcript(session), actionStatus: (summary?.actions || []).map(action => session.completedActions?.[meetingActionId(action)] === true) };
  };
  const status = () => ({ active: active() ? publicSession(active()) : null, offer: offer ? { ...offer } : null,
    sessions: [...store.sessions.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 100).map(publicSession), settings: { ...settings }, capabilities, candidates, browser: browser?.status() || null, errors: store.errors });
  const publish = () => { if (!closing) notify({ type: 'meeting-state', ...status() }); };
  const recordError = (session, error) => { session.errors ||= []; const message = failureText(error); if (!session.errors.includes(message)) { session.errors.push(message); store.save(session); } };
  const syncNote = async (session, summary = store.readSummary(session.id)) => {
    try { await writer.sync(session, store.transcript(session), summary); }
    catch (error) { session.noteError = failureText(error); store.save(session); }
  };
  const recover = session => {
    if (session.id === activeId) {
      // The native recorder survives a host restart. Only finalized journal entries are safe to replay while it owns .part files.
      const journal = join(store.audioDirectory(session.id), 'manifest.jsonl');
      if (existsSync(journal)) for (const line of readFileSync(journal, 'utf8').split('\n')) {
        let chunk;
        try { chunk = JSON.parse(line); } catch { continue; }
        if (chunk?.type === 'chunk') try { store.addChunk(session, chunk); } catch (error) { recordError(session, error); }
      }
      for (const chunk of session.chunks) {
        if (existsSync(join(store.folder(session.id), 'transcript', `${chunk.id}.json`))) chunk.status = 'done';
        else if (chunk.status === 'processing') chunk.status = 'pending';
      }
    } else store.recover(session);
    if (session.id !== activeId && activeStates.has(session.state)) {
      session.state = 'interrupted'; session.interrupted = true; session.endedAt = session.endedAt || Date.now();
      recordError(session, new Error('Recording was interrupted. Saved audio is being recovered; recording has not restarted.'));
    }
    if (session.summaryState === 'running') session.summaryState = 'pending';
    store.save(session);
  };
  // Reconcile before recovering any partial WAV: the desktop recorder may still have an open handle after Node alone crashed.
  const capture = await native('meeting-call', { action: 'status' });
  if (!capture || !['idle', 'starting', 'recording', 'paused', 'stopping', 'stopped', 'error'].includes(capture.state)) throw new Error('The native meeting recorder state could not be verified. Audio recovery has not started.');
  const attached = store.sessions.get(capture.sessionId);
  if (attached && ['recording', 'paused'].includes(capture.state)) {
    activeId = attached.id; attached.state = capture.state; attached.summaryState = 'waiting';
    delete attached.endedAt; delete attached.interrupted; attached.nextSummaryRetryAt = null;
    if (Number.isFinite(capture.elapsedMs)) attached.elapsedMs = Math.max(attached.elapsedMs || 0, capture.elapsedMs);
    if (typeof capture.muted === 'boolean') attached.muted = capture.muted;
    if (Array.isArray(capture.sources)) attached.sources = capture.sources;
  } else if (activeStates.has(capture.state)) {
    const stopped = await native('meeting-call', { action: 'stop', ...(capture.sessionId ? { sessionId: capture.sessionId } : {}) });
    if (!stopped || !['idle', 'stopped', 'error'].includes(stopped.state)) throw new Error('The unrecognized meeting recorder did not confirm stopping. Audio recovery has not started.');
    store.errors.push({ sessionId: capture.sessionId, message: 'An unrecognized recording was stopped and its audio flushed to disk. Existing saved audio is preserved for recovery.' });
  }
  for (const session of store.sessions.values()) recover(session);

  async function finishSession(session) {
    if (session.chunks.some(chunk => chunk.status === 'error')) { session.state = 'error'; store.save(session); return; }
    const segments = store.transcript(session);
    if (!segments.length) { session.summaryState = 'empty'; session.state = finalState(session); await syncNote(session); return; }
    if (session.summaryState === 'ready') { session.state = finalState(session); store.save(session); return; }
    if (session.nextSummaryRetryAt > Date.now()) return;
    session.summaryState = 'running'; store.save(session); publish();
    const controller = summaryAbort = new AbortController();
    try {
      const summary = await summarize({ directory, binary, settings: await getSettings(), session, segments, summaryLanguage: settings.summaryLanguage, signal: controller.signal });
      if (closing) return;
      store.saveSummary(session.id, summary);
      session.summaryState = 'ready'; session.summaryError = null; session.nextSummaryRetryAt = null;
      session.state = finalState(session);
      await syncNote(session, summary);
      if (!settings.retainAudio && !session.noteError) {
        for (const chunk of session.chunks) try { unlinkSync(chunk.path); } catch (error) { if (error.code !== 'ENOENT') recordError(session, error); }
        session.audioRetained = false;
      }
      store.save(session);
    } catch (error) {
      session.summaryState = 'pending'; session.summaryError = failureText(error);
      session.summaryAttempts = (session.summaryAttempts || 0) + 1;
      session.nextSummaryRetryAt = Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** Math.min(session.summaryAttempts - 1, 6));
      store.save(session);
      if (!closing) await syncNote(session);
    } finally { if (summaryAbort === controller) summaryAbort = null; publish(); }
  }

  async function drain() {
    while (!closing) {
      const session = [...store.sessions.values()].find(value => value.chunks.some(chunk => chunk.status === 'pending'));
      if (!session) break;
      // Yield the warm worker between meeting chunks to interactive dictation.
      if (transcription.isBusy?.('dictation')) break;
      const chunk = session.chunks.find(value => value.status === 'pending');
      chunk.status = 'processing'; store.save(session);
      const id = currentJob = `meeting:${session.id}:${chunk.id}`;
      try {
        const result = await transcription.send('transcribe', { path: chunk.path, options: { transcriptOnly: true, language: 'auto', cleanupLevel: 'none' } }, id, { owner: 'meeting' });
        store.completeChunk(session, chunk, result);
        // Notes receive regular durable checkpoints; audio and transcript chunks are already saved.
        if (!session.lastNoteAt || Date.now() - session.lastNoteAt > 30_000) { await syncNote(session); session.lastNoteAt = Date.now(); store.save(session); }
      } catch (error) {
        chunk.status = closing || error.code === 'CANCELLED' ? 'pending' : 'error'; chunk.error = failureText(error); store.save(session);
      } finally { if (currentJob === id) currentJob = null; publish(); }
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  async function summarizePending() {
    for (const session of store.sessions.values()) {
      if (closing) return;
      if (activeStates.has(session.state) || session.chunks.some(chunk => ['pending', 'processing'].includes(chunk.status)) || ['ready', 'empty', 'running', 'error'].includes(session.summaryState) || session.nextSummaryRetryAt > Date.now()) continue;
      if (session.chunks.some(chunk => chunk.status === 'error')) { session.state = 'error'; session.summaryState = 'error'; store.save(session); await syncNote(session); publish(); continue; }
      await syncNote(session); if (!closing) await finishSession(session);
    }
  }
  function wake() {
    if (!draining && !closing) draining = drain().catch(error => { store.errors.push({ message: failureText(error) }); publish(); }).finally(() => {
      draining = null;
      if (!summarizing && !closing) summarizing = summarizePending().catch(error => { store.errors.push({ message: failureText(error) }); publish(); }).finally(() => { summarizing = null; });
    });
  }

  async function probe() {
    capabilities = await native('meeting-call', { action: 'probe' });
    candidates = Array.isArray(capabilities.candidates) ? capabilities.candidates.map(value => ({ ...value, confirmedCall: false })) : [];
    publish(); return capabilities;
  }
  function suppress(value) {
    const now = Date.now(), until = value.calendarEvent?.endMs > now ? value.calendarEvent.endMs + 5 * 60_000 : now + 30 * 60_000;
    if (value.callId) suppressed.set(value.callId, now + 24 * 60 * 60_000);
    if (value.calendarEvent?.id) suppressed.set(`calendar:${value.calendarEvent.id}`, until);
    if (value.conferenceId) suppressed.set(`conference:${value.conferenceId}`, until);
  }
  function makeOffer(value, kind = 'manual') {
    if (active()) return status();
    const callId = shortText(value.callId || value.id || randomUUID(), 500);
    const conferenceId = shortText(value.conferenceId || value.calendarEvent?.conferenceId, 500);
    if (suppressed.has(callId) || conferenceId && suppressed.has(`conference:${conferenceId}`)) return status();
    if (offer?.callId === callId) return status();
    const calendarEvent = value.calendarEvent || (conferenceId ? calendarEvents.find(event => event.conferenceId === conferenceId) : null);
    offer = { id: offer?.conferenceId === conferenceId && conferenceId ? offer.id : randomUUID(), callId, conferenceId, kind, confirmedCall: kind === 'call', createdAt: Date.now(), title: shortText(value.title || calendarEvent?.title), application: shortText(value.application), processId: value.processId, microphoneDeviceId: value.microphoneDeviceId, calendarEvent };
    publish(); return status();
  }
  function reminders() {
    if (!settings.automaticOffers || active() || offer) return;
    const now = Date.now();
    for (const [id, until] of suppressed) if (until < now) suppressed.delete(id);
    const event = calendarEvents.find(value => value.startMs - 120_000 <= now && value.endMs > now && !suppressed.has(`calendar:${value.id}`) && !(value.conferenceId && suppressed.has(`conference:${value.conferenceId}`)));
    if (event) makeOffer({ callId: `calendar:${event.id}`, title: event.title, calendarEvent: event }, 'calendar');
  }

  async function start(value = {}) {
    if (active()) return status();
    const loopbackMode = value.loopbackMode === 'system' ? 'system' : 'process';
    if (loopbackMode === 'process' && (!Number.isSafeInteger(value.processId) || value.processId < 1)) throw new Error('Choose the application whose call audio should be recorded.');
    const id = randomUUID(), now = Date.now();
    const session = { id, title: shortText(value.title) || `Meeting ${new Date(now).toLocaleString()}`, application: shortText(value.application), callId: shortText(value.callId, 500), conferenceId: shortText(value.conferenceId || value.calendarEvent?.conferenceId, 500), calendarEvent: value.calendarEvent,
      startedAt: now, state: 'starting', elapsedMs: 0, muted: false, processId: value.processId || 0, loopbackMode, microphoneDeviceId: value.microphoneDeviceId,
      summaryState: 'waiting', errors: [], chunks: [], audioRetained: true };
    mkdirSync(store.audioDirectory(id), { recursive: true }); store.save(session); activeId = id; offer = null;
    suppress(session);
    publish();
    try {
      await writer.ensure(session); await syncNote(session);
      const capture = await native('meeting-call', { action: 'start', sessionId: id, directory: store.audioDirectory(id), processId: session.processId, microphoneDeviceId: session.microphoneDeviceId, loopbackMode, chunkSeconds: 15 });
      session.state = capture.state || 'recording'; session.sources = capture.sources || []; store.save(session);
    } catch (error) {
      await native('meeting-call', { action: 'stop', sessionId: id }).catch(() => {});
      session.state = 'error'; session.captureFailed = true; session.endedAt = Date.now(); session.summaryState = 'pending'; activeId = null; recordError(session, error); await syncNote(session); wake(); throw error;
    } finally { publish(); }
    return status();
  }
  async function stop() {
    const session = active(); if (!session) return status();
    session.state = 'stopping'; store.save(session); publish();
    try {
      const result = await native('meeting-call', { action: 'stop', sessionId: session.id });
      for (const chunk of result.chunks || []) store.addChunk(session, chunk);
      session.elapsedMs = session.chunks.reduce((end, chunk) => Math.max(end, chunk.endMs), Math.max(session.elapsedMs, result.elapsedMs || 0));
    } catch (error) {
      recordError(session, error);
      const current = await native('meeting-call', { action: 'status' }).catch(() => null);
      if (!current || !['stopped', 'error', 'idle'].includes(current.state)) { session.state = 'error'; store.save(session); publish(); return status(); }
    }
    store.recover(session);
    session.endedAt = Date.now(); session.state = 'processing'; session.summaryState = 'pending'; activeId = null; store.save(session);
    await syncNote(session); publish(); wake(); return status();
  }

  const methods = {
    status, list: () => [...store.sessions.values()].sort((a, b) => b.startedAt - a.startedAt).map(publicSession), sources: probe, offer: value => makeOffer(value, value.kind === 'calendar' ? 'calendar' : 'manual'), start,
    read: value => detail(store.get(value.id)),
    'read-note': value => { if (typeof value.noteId !== 'string') throw new Error('Choose a meeting note.'); const session = [...store.sessions.values()].find(session => session.noteId === value.noteId); return session ? detail(session) : null; },
    'action-check': async value => {
      const session = store.get(value.id), summary = store.readSummary(session.id);
      if (!Number.isSafeInteger(value.index) || value.index < 0 || typeof value.checked !== 'boolean' || !summary?.actions[value.index] || summary.actions[value.index].text !== value.text) throw new Error('This meeting action changed. Reload its summary before updating the checklist.');
      const key = meetingActionId(summary.actions[value.index]); session.completedActions ||= {};
      if (value.checked) session.completedActions[key] = true; else delete session.completedActions[key];
      store.save(session); await syncNote(session, summary); publish(); return detail(session);
    },
    'browser-status': () => browser?.status() || null,
    'browser-pair': () => { if (!browser) throw new Error('Browser detection is unavailable. Restart LocalFlow.'); return browser.pair(); },
    'browser-disconnect': () => { browser?.disconnect(); publish(); return status(); },
    accept: value => { const selected = offer ? { ...offer, ...value } : value; return start(selected); },
    decline: () => { if (offer) suppress(offer); offer = null; publish(); return status(); },
    stop,
    configure: value => {
      if (Object.hasOwn(value, 'automaticOffers')) { if (typeof value.automaticOffers !== 'boolean') throw new Error('Invalid meeting notification setting.'); settings.automaticOffers = value.automaticOffers; }
      if (Object.hasOwn(value, 'retainAudio')) { if (typeof value.retainAudio !== 'boolean') throw new Error('Invalid audio retention setting.'); settings.retainAudio = value.retainAudio; }
      if (Object.hasOwn(value, 'summaryLanguage')) { if (typeof value.summaryLanguage !== 'string' || !/^(auto|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/.test(value.summaryLanguage)) throw new Error('Choose a language code.'); settings.summaryLanguage = value.summaryLanguage; }
      persistSettings(); publish(); return status();
    },
    retry: async value => {
      const session = value.id ? store.get(value.id) : [...store.sessions.values()].sort((a, b) => b.startedAt - a.startedAt).find(value => !activeStates.has(value.state));
      if (!session || activeStates.has(session.state)) throw new Error('Finish a meeting before retrying its processing.');
      store.recover(session); for (const chunk of session.chunks) if (chunk.status === 'error') { chunk.status = 'pending'; delete chunk.error; }
      session.summaryState = 'pending'; session.nextSummaryRetryAt = null; session.summaryError = null; session.state = 'processing'; store.save(session); publish(); wake(); return status();
    },
    'open-note': value => { const session = value.id ? store.get(value.id) : active() || [...store.sessions.values()].sort((a, b) => b.startedAt - a.startedAt)[0]; if (!session?.noteId) throw new Error('This meeting has no note yet.'); notify({ type: 'meeting-open-note', noteId: session.noteId }); return { noteId: session.noteId }; },
    'calendar-events': value => { calendarEvents = (Array.isArray(value.events) ? value.events : []).filter(event => typeof event.id === 'string' && Number.isFinite(event.startMs) && Number.isFinite(event.endMs) && event.endMs > event.startMs).map(event => ({ id: shortText(event.id, 500), title: shortText(event.title), startMs: event.startMs, endMs: event.endMs, conferenceId: shortText(event.conferenceId, 500), calendarId: shortText(event.calendarId, 500) })); reminders(); return status(); },
  };
  for (const action of ['pause', 'resume', 'mute']) methods[action] = async value => {
    const session = active(); if (!session || !['recording', 'paused'].includes(session.state)) throw new Error('No meeting is recording.');
    if (action === 'mute' && typeof value.muted !== 'boolean') throw new Error('Invalid microphone mute state.');
    const result = await native('meeting-call', { action, sessionId: session.id, ...(action === 'mute' ? { muted: value.muted } : {}) });
    session.state = result.state || (action === 'pause' ? 'paused' : action === 'resume' ? 'recording' : session.state);
    if (action === 'mute') session.muted = value.muted;
    store.save(session); publish(); return status();
  };

  function nativeEvent(event) {
    if (!event || typeof event.type !== 'string' || closing) return status();
    if (event.type === 'candidate') {
      candidates = [...candidates.filter(value => value.callId !== event.callId), event].slice(-30);
      if (settings.automaticOffers && event.confirmedCall === true && event.callId) makeOffer(event, 'call'); else publish();
      return status();
    }
    if (event.type === 'call-ended') {
      const ended = candidates.find(value => value.callId === event.callId);
      candidates = candidates.filter(value => value.callId !== event.callId);
      if (event.reason === 'connection-ended' && ended?.conferenceId && !candidates.some(value => value.conferenceId === ended.conferenceId)) suppressed.delete(`conference:${ended.conferenceId}`);
      if (offer?.callId === event.callId) offer = null;
      if (active()?.callId === event.callId) {
        const session = active(); session.callEnded = true; store.save(session);
        if (event.reason === 'connection-ended') { const operation = actions.then(stop); actions = operation.catch(error => recordError(session, error)); }
      }
      publish(); return status();
    }
    const session = store.sessions.get(event.sessionId); if (!session) return status();
    if (event.type === 'chunk') { store.addChunk(session, event); wake(); }
    if (event.type === 'state') {
      const state = event.status || event;
      if (['recording', 'paused'].includes(state.state) && activeId === session.id) session.state = state.state;
      if (Number.isFinite(state.elapsedMs)) session.elapsedMs = Math.max(session.elapsedMs, state.elapsedMs);
      if (typeof state.muted === 'boolean') session.muted = state.muted;
      if (Array.isArray(state.sources)) session.sources = state.sources;
      if (['stopped', 'error'].includes(state.state) && activeId === session.id && session.state !== 'stopping') {
        if (state.state === 'error') session.captureFailed = true;
        for (const chunk of state.chunks || []) store.addChunk(session, chunk);
        session.endedAt = Date.now(); session.state = 'processing'; session.summaryState = 'pending'; activeId = null; store.save(session); wake();
      }
    }
    if (['error', 'source-error', 'gap'].includes(event.type)) {
      if (event.fatal === true) session.captureFailed = true;
      if (event.type === 'gap') { session.gaps ||= []; session.gaps.push({ source: event.source, startMs: event.startMs, durationMs: event.durationMs, reason: event.reason }); store.save(session); }
      recordError(session, new Error(event.message || event.error || `${event.source || 'Audio'}: ${event.reason || 'capture interruption'}`));
    }
    if (event.type === 'source-restored') { session.sources = (session.sources || []).map(value => value.source === event.source ? { ...value, available: true, error: null } : value); }
    if (event.type === 'process-ended' && activeId === session.id) {
      session.callEnded = true; store.save(session);
      const operation = actions.then(stop); actions = operation.catch(error => recordError(session, error));
    }
    publish(); return status();
  }
  try { browser = await createBrowserBridge({ directory, onEvent: nativeEvent, getSources: probe }); }
  catch (error) { store.errors.push({ message: `Browser detection: ${failureText(error)}` }); }
  timer = setInterval(() => { reminders(); wake(); }, 2000); timer.unref?.();
  wake();
  return {
    call(method, params = {}) {
      if (closing) return Promise.reject(new Error('Meetings are closing.'));
      if (!Object.hasOwn(methods, method) || !params || typeof params !== 'object' || Array.isArray(params)) return Promise.reject(new Error('Unknown meeting operation.'));
      // A double click and native events cannot create two recording sessions.
      const operation = actions.then(() => methods[method](params)); actions = operation.catch(() => {}); return operation;
    },
    nativeEvent,
    async close() {
      if (closing) return;
      closing = true; clearInterval(timer); summaryAbort?.abort(); if (currentJob) transcription.cancel(currentJob);
      await browser?.close(); await actions;
      if (active()) await stop();
      await draining; await summarizing; store.saveSettings(settings);
    },
  };
}
