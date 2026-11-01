import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function writeRecord(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = openSync(temporary, 'w', 0o600);
  try { writeFileSync(file, JSON.stringify(value)); fsyncSync(file); } finally { closeSync(file); }
  renameSync(temporary, path);
}

const read = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
const sessionId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export function createMeetingStore(directory) {
  const root = resolve(directory, 'meetings');
  mkdirSync(root, { recursive: true });
  const sessions = new Map(), errors = [];
  const folder = id => { if (!sessionId(id)) throw new Error('Invalid meeting ID.'); return join(root, id); };
  for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory() && sessionId(entry.name)) {
    try {
      const value = read(join(folder(entry.name), 'session.json'));
      if (value?.id === entry.name && Array.isArray(value.chunks)) sessions.set(value.id, value);
    } catch (error) { errors.push({ sessionId: entry.name, message: `Meeting metadata needs recovery: ${error.message}` }); }
  }
  const get = id => { const value = sessions.get(id); if (!value) throw new Error('Meeting not found.'); return value; };
  const save = session => { writeRecord(join(folder(session.id), 'session.json'), session); sessions.set(session.id, session); return session; };
  const audioDirectory = id => join(folder(id), 'audio');
  const chunkPath = (id, chunk) => join(folder(id), 'transcript', `${chunk.id}.json`);
  function addChunk(session, event) {
    if (!['microphone', 'remote'].includes(event.source) || !Number.isSafeInteger(event.index) || event.index < 0 ||
        !Number.isFinite(event.startMs) || !Number.isFinite(event.endMs) || event.startMs < 0 || event.endMs <= event.startMs ||
        typeof event.path !== 'string' || !isAbsolute(event.path)) throw new Error('Invalid recorded audio chunk.');
    const id = `${event.source}-${event.index}`;
    if (session.chunks.some(chunk => chunk.id === id)) return false;
    const path = realpathSync(event.path), base = realpathSync(audioDirectory(session.id));
    const child = relative(base, path);
    if (!child || child.startsWith('..') || isAbsolute(child) || !path.endsWith('.wav') || !statSync(path).isFile()) throw new Error('Recorded audio is outside this meeting.');
    const chunk = { id, source: event.source, index: event.index, path, startMs: event.startMs, endMs: event.endMs, status: 'pending' };
    if (existsSync(chunkPath(session.id, chunk))) chunk.status = 'done';
    session.chunks.push(chunk);
    session.chunks.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
    save(session);
    return true;
  }
  function recover(session) {
    const audio = audioDirectory(session.id);
    if (!existsSync(audio) || session.audioRetained === false) return;
    const journal = join(audio, 'manifest.jsonl');
    const candidates = [], recoveredParts = [];
    if (existsSync(journal)) {
      for (const line of readFileSync(journal, 'utf8').split('\n')) if (line.trim()) {
        try { const event = JSON.parse(line); if (event.type === 'chunk') candidates.push(event); }
        catch { /* A terminated process can leave only the last journal line incomplete. WAV discovery below recovers it. */ }
      }
    }
    for (const name of readdirSync(audio)) {
      if (name.endsWith('.wav.part.json')) {
        try {
          const metadata = read(join(audio, name)), path = join(audio, name.slice(0, -5));
          if (metadata.sessionId !== session.id || !['microphone', 'remote'].includes(metadata.source) || !Number.isSafeInteger(metadata.index) || metadata.index < 0 || !Number.isFinite(metadata.startMs) || metadata.startMs < 0 || !existsSync(path)) continue;
          if (statSync(path).size > 64 * 1024 * 1024) throw new Error('Partial meeting chunk exceeds the recovery limit.');
          const bytes = readFileSync(path), align = metadata.channels * 2;
          if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(34) !== 16 || ![1, 2].includes(metadata.channels) || bytes.readUInt16LE(22) !== metadata.channels || !Number.isInteger(metadata.sampleRate) || metadata.sampleRate < 8000 || metadata.sampleRate > 192000 || bytes.readUInt32LE(24) !== metadata.sampleRate) throw new Error('Partial audio has an unsupported WAV header.');
          const length = Math.floor((bytes.length - 44) / align) * align;
          if (!length) continue;
          const endMs = metadata.startMs + length / align / metadata.sampleRate * 1000;
          const recoveredPath = join(audio, `${metadata.source}-${metadata.index}-${Math.round(metadata.startMs * 1000)}-${Math.round(endMs * 1000)}.wav`);
          if (!existsSync(recoveredPath)) {
            bytes.writeUInt32LE(length + 36, 4); bytes.writeUInt32LE(length, 40);
            const temporary = `${recoveredPath}.recovery`, handle = openSync(temporary, 'w', 0o600);
            try { writeFileSync(handle, bytes.subarray(0, length + 44)); fsyncSync(handle); } finally { closeSync(handle); }
            renameSync(temporary, recoveredPath);
          }
          candidates.push({ ...metadata, path: recoveredPath, endMs });
          recoveredParts.push({ id: `${metadata.source}-${metadata.index}`, path, sidecar: join(audio, name), recoveredPath });
        } catch (error) { session.errors ||= []; if (!session.errors.includes(error.message)) session.errors.push(error.message); }
      }
      const match = /^(microphone|remote)-(\d+)-(\d+)-(\d+)\.wav$/.exec(name);
      if (match) candidates.push({ source: match[1], index: Number(match[2]), startMs: Number(match[3]) / 1000, endMs: Number(match[4]) / 1000, path: join(audio, name) });
    }
    for (const chunk of candidates) {
      try { addChunk(session, chunk); }
      catch (error) { session.errors ||= []; if (!session.errors.includes(error.message)) session.errors.push(error.message); }
    }
    // The replacement WAV and its session index are durable before removing the incomplete copy.
    for (const part of recoveredParts) if (session.chunks.some(chunk => chunk.id === part.id && chunk.path === realpathSync(part.recoveredPath))) {
      try { unlinkSync(part.path); unlinkSync(part.sidecar); }
      catch (error) { if (error.code !== 'ENOENT') { session.errors ||= []; session.errors.push(error.message); } }
    }
    for (const chunk of session.chunks) {
      if (existsSync(chunkPath(session.id, chunk))) chunk.status = 'done';
      else if (chunk.status === 'processing') chunk.status = 'pending';
    }
    save(session);
  }
  function completeChunk(session, chunk, result) {
    const duration = chunk.endMs - chunk.startMs;
    const source = Array.isArray(result.segments) ? result.segments : [];
    const segments = source.filter(segment => typeof segment.text === 'string' && segment.text.trim() && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start).map((segment, index) => ({
      id: `${chunk.id}-${index}`, source: chunk.source,
      startMs: chunk.startMs + Math.max(0, Math.min(duration, segment.start * 1000)),
      endMs: chunk.startMs + Math.max(0, Math.min(duration, segment.end * 1000)),
      text: segment.text.trim(), language: typeof result.language === 'string' ? result.language : 'auto',
    })).filter(segment => segment.endMs > segment.startMs);
    if (!segments.length && typeof result.rawText === 'string' && result.rawText.trim()) segments.push({ id: `${chunk.id}-0`, source: chunk.source, startMs: chunk.startMs, endMs: chunk.endMs, text: result.rawText.trim(), language: result.language || 'auto' });
    writeRecord(chunkPath(session.id, chunk), { ...chunk, status: 'done', segments });
    chunk.status = 'done'; delete chunk.error; save(session);
  }
  function transcript(session) {
    return session.chunks.filter(chunk => chunk.status === 'done').flatMap(chunk => read(chunkPath(session.id, chunk), { segments: [] }).segments).sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  }
  return { root, errors, folder, audioDirectory, sessions, get, save, addChunk, recover, completeChunk, transcript,
    readSettings: () => read(join(root, 'settings.json'), {}),
    saveSettings: value => writeRecord(join(root, 'settings.json'), value),
    readGenerated: id => read(join(folder(id), 'generated-note.json'), null),
    saveGenerated: (id, value) => writeRecord(join(folder(id), 'generated-note.json'), value),
    saveSummary: (id, value) => writeRecord(join(folder(id), 'summary.json'), value),
    readSummary: id => read(join(folder(id), 'summary.json'), null),
  };
}
