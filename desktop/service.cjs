// Feature host: stdin/stdout are private structured messages, never a network listener.
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { spawn } = require('node:child_process');
const runtime = require('../host/runtime-config.cjs');
const { terminateProcess } = require('../host/child-process.cjs');
const { createTranscriptionWorker } = require('../host/transcription-worker.cjs');
const { createCleanupAuthManager } = require('../host/cleanup-auth.cjs');
const { createPasteHandler } = require('../host/paste-text.cjs');
const { readShortcuts, ensureShortcuts, saveShortcut } = require('../host/shortcuts.cjs');
const { LIVE_MODEL } = require('../host/realtime-config.cjs');

const directory = process.env.LOCALFLOW_USER_DATA;
if (!directory || !path.isAbsolute(directory)) throw new Error('Use an absolute LocalFlow profile.');
fs.mkdirSync(directory, { recursive: true });
runtime.loadDotEnv(); runtime.ensureRuntimeEnv();
process.env.CODEX_HOME = path.join(directory, 'niwa/codex');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(runtime.resourcesRoot(), 'runtime/browsers');
process.env.LOCALFLOW_VOICE_OUTPUT_DIR = path.join(directory, 'voice-output');
ensureShortcuts(directory);

const send = packet => process.stdout.write(JSON.stringify(packet) + '\n');
const notify = (event, value) => send({ event, value });
let sequence = 0, closing = false;
const nativePending = new Map();
const native = (method, ...args) => new Promise((resolve, reject) => {
  const nativeId = ++sequence;
  const timer = setTimeout(() => { nativePending.delete(nativeId); reject(new Error('Desktop operation timed out.')); }, 180_000);
  nativePending.set(nativeId, { resolve, reject, timer }); send({ native: method, nativeId, args });
});
let notes, notesReady, agent, agentReady, hotkey, capture = false, voice, duplex;
async function getNotes() {
  if (!notesReady) notesReady = (async () => {
    const { createNotesService } = await import('../host/notes-service.mjs');
    notes = createNotesService(directory, change => notify('niwa-event', { type: 'notes-changed', ...change }));
    return notes;
  })().catch(error => { notesReady = null; throw error; });
  return notesReady;
}
async function getAgent() {
  if (!agentReady) agentReady = (async () => {
    const { createNiwaAgent } = await import('../host/niwa-agent.mjs');
    agent = createNiwaAgent({ directory, appRoot: runtime.appRoot(), binary: runtime.resolveNiwaCodexBinary,
      notes: await getNotes(), bundledConnectors: require('../host/bundled-connectors.cjs').bundledConnectors(runtime.resourcesRoot()),
      captureScreen: (params, signal) => { signal?.throwIfAborted(); return native('capture-screen', params); },
      speak: async text => { const manager = getVoice(); return { model: voiceModel(), log: JSON.stringify(await manager.speak(voiceModel(), text)) }; },
      notify: value => { notify('niwa-event', value); if (['busy','voice','approval'].includes(value.type)) void native('agent-state', value).catch(report); },
    }); return agent;
  })().catch(error => { agentReady = null; throw error; });
  return agentReady;
}
function report(error) { notify('host-error', error.message); }
const auth = createCleanupAuthManager({ codexBin: runtime.resolveCodexBinary, userDataPath: directory,
  notify: value => notify('cleanup-auth-event', value), openBrowser: url => native('open-url', url) });
function getVoice() {
  if (!voice) {
    const { createVoiceOutputManager } = require('../host/voice-output.cjs');
    const { resolveTtsRoot } = require('../host/tts-runtime.cjs');
    process.env.LOCALFLOW_VOICE_ROOT = resolveTtsRoot(runtime.appRoot(), process.env.LOCALFLOW_PACKAGED === '1', process.env.LOCALAPPDATA || directory);
    voice = createVoiceOutputManager(runtime.resourcesRoot());
  }
  return voice;
}
const voiceModel = () => process.env.LOCALFLOW_VOICE_OUTPUT_MODEL || 'piper';
const voiceConfig = () => { const inventory = getVoice().inspect(); return { model: voiceModel(), voiceRoot: inventory.voiceRoot, options: inventory.options.map(({ python, ...option }) => option) }; };
const transcription = createTranscriptionWorker({ python: runtime.resolvePython(), script: path.join(runtime.resourcesRoot(), 'backend/worker.py'), cwd: runtime.resourcesRoot(),
  notify: value => notify('worker-progress', value), cleanup: (value, signal) => {
    duplex ||= require('../host/duplex-cleanup.cjs').createDuplexCleanup({ binary: runtime.resolveNiwaCodexBinary, directory,
      createTransport: () => ({ call: (method, args) => native('cleanup-transport', method, args), close: () => native('cleanup-close') }) });
    return duplex.clean(value, signal);
  } });
function startHotkey() {
  if (hotkey) return hotkey;
  const python = runtime.resolvePython();
  const child = hotkey = spawn(python.command, [...python.args, path.join(runtime.resourcesRoot(), 'backend/hotkey_watcher.py')], {
    cwd: runtime.resourcesRoot(), env: { ...process.env, LOCALFLOW_SHORTCUTS_JSON: JSON.stringify(readShortcuts(directory)), LOCALFLOW_SHORTCUT_CAPTURE: capture ? '1' : '0' },
    windowsHide: true, stdio: ['pipe','pipe','pipe'],
  });
  createInterface({ input: child.stdout }).on('line', line => {
    let value; try { value = JSON.parse(line); } catch { return; }
    if (value.type === 'paste-result') child.emit('paste-result', value);
    else if (value.type === 'shortcut-captured' && capture) notify('shortcut-captured', value.binding);
    else if (value.type === 'hotkey' && !capture) notify('dictation-hotkey', value);
  });
  child.stderr.on('data', chunk => notify('worker-progress', { type: 'stderr', message: `[keyboard] ${chunk.toString().trim()}` }));
  child.on('error', report); child.stdin.on('error', report);
  child.on('exit', () => { if (hotkey === child) hotkey = null; });
  return child;
}
const paste = createPasteHandler({ clipboard: { writeText: text => native('copy-text', text) }, getWorker: startHotkey });
const configure = async (key, value, params) => { await transcription.send('configure', params); process.env[key] = value; runtime.persistDotEnvValue(key, value); };
const handlers = {
  'desktop-ready': () => { if (!process.env.LOCALFLOW_TEST_NO_INPUT) startHotkey(); if (!process.env.LOCALFLOW_TEST_NO_WARMUP) void transcription.send('warmup').catch(report); return true; },
  'transcribe-file': async value => {
    if (!value || typeof value.path !== 'string' || !path.isAbsolute(value.path) || !fs.statSync(value.path).isFile()) throw new Error('Choose an existing audio file.');
    return transcription.send('transcribe', value, value.requestId);
  },
  'cancel-transcription': () => transcription.stop(),
  'set-whisper-model': async model => {
    if (!['base','small','large-v3-turbo',...runtime.BUNDLED_WHISPER_MODELS,'nemo-parakeet-tdt-0.6b-v3','nemo-canary-1b-v2'].includes(model)) throw new Error('Unsupported STT model.');
    if (!(await transcription.send('model-status', { model })).available) {
      if (!await native('confirm-model', model)) return null;
      await transcription.send('download-model', { model });
    }
    await configure('LOCALFLOW_WHISPER_MODEL', model, { model });
    return { whisperModel: model, whisperDownloadRoot: process.env.LOCALFLOW_WHISPER_DOWNLOAD_ROOT };
  },
  'set-whisper-language': async language => {
    if (typeof language !== 'string' || !/^(auto|[a-z]{2,3})$/.test(language)) throw new Error('Unsupported language code.');
    await configure('LOCALFLOW_WHISPER_LANGUAGE', language, { language });
    return { language, outputLanguage: language === 'auto' ? 'Original language' : language };
  },
  'cleanup-auth-status': () => auth.inspect(),
  'get-cleanup-models': async () => {
    const selected = process.env.LOCALFLOW_CLEANUP_MODEL || 'gpt-5.6-terra'; let models = [], error = '';
    try { models = (await auth.models()).map(item => ({ id: item.model, label: item.displayName })); } catch (failure) { error = failure.message; }
    if (!models.some(item => item.id === selected) && selected !== LIVE_MODEL) models.unshift({ id: selected, label: selected });
    return { selected, models: [...models.filter(item => item.id !== LIVE_MODEL), { id: LIVE_MODEL, label: 'Live 1 · realtime cleanup' }], error };
  },
  'set-cleanup-model': async model => { if (model !== LIVE_MODEL && !(await auth.models()).some(item => item.model === model)) throw new Error('Select an available model.'); await configure('LOCALFLOW_CLEANUP_MODEL', model, { cleanupModel: model }); return model; },
  'cleanup-auth-connect-codex': () => { agent?.disconnect(); return auth.connectCodex(); },
  'cleanup-auth-connect-api-key': key => { agent?.disconnect(); return auth.connectApiKey(key); },
  'cleanup-auth-disconnect': () => { agent?.disconnect(); return auth.disconnect(); },
  'cleanup-auth-cancel': () => auth.cancel(),
  'cleanup-auth-open-browser': () => auth.openCurrentBrowser(),
  'get-voice-output-config': voiceConfig,
  'set-voice-output-model': async model => {
    if (!require('../host/voice-output.cjs').ALLOWED_VOICE_OUTPUT_MODELS.has(model)) throw new Error('Unsupported voice model.');
    const manager = getVoice(); let option = manager.inspect().options.find(item => item.id === model);
    if (!option?.available && model !== 'xvasynth') { await require('../host/tts-runtime.cjs').ensureTtsRuntime(runtime.resourcesRoot(), manager.inspect().voiceRoot, model, model => native('confirm-model', model)); option = manager.inspect().options.find(item => item.id === model); }
    if (!option?.available) throw new Error(option?.detail || 'Voice is unavailable.');
    manager.stop(); process.env.LOCALFLOW_VOICE_OUTPUT_MODEL = model; runtime.persistDotEnvValue('LOCALFLOW_VOICE_OUTPUT_MODEL', model); return voiceConfig();
  },
  'get-shortcuts': () => readShortcuts(directory),
  'set-shortcut-capture': active => { if (typeof active !== 'boolean') throw new Error('Invalid shortcut capture.'); capture = active; if(!process.env.LOCALFLOW_TEST_NO_INPUT)startHotkey().stdin.write(JSON.stringify({ capture:active }) + '\n'); },
  'set-shortcut': value => { const config = saveShortcut(directory, value?.action, value?.binding); terminateProcess(hotkey); hotkey = null; startHotkey(); return config; },
  'paste-text': paste,
  'recording-start': () => { voice?.cancel(); void transcription.send('warmup').catch(report); },
  'export-text': async value => { const target = await native('save-dialog', { title:'Export text', defaultName:value.defaultName || 'localflow-transcript.txt', extensions:['txt','md'] }); if (!target) return null; await fs.promises.writeFile(target, String(value.text || ''), 'utf8'); return target; },
  'notes-pick-assets': async () => { const files = await native('open-dialog', { title:'Add images or files', multiple:true }); return (await import('../host/notes/uploads.mjs')).importUploadPaths(path.join(directory,'notes'), files); },
  'notes-upload-assets': async files => (await import('../host/notes/uploads.mjs')).storeUploads(path.join(directory,'notes'), files.map(file => ({...file, data:Buffer.from(file.data)}))),
  'notes-open-asset': url => native('reveal-path', require('../host/notes/asset-path.cjs').resolveAsset(path.join(directory,'notes'), url)),
  'notes-export-pdf': async value => { const target = await native('save-dialog', { title:'Export PDF', defaultName:String(value.title || 'Page').replace(/[<>:"/\\|?*]/g,'-')+'.pdf', extensions:['pdf'] }); if (!target) return null; const html = await require('../host/notes/pdf.cjs').printableHtml(path.join(directory,'notes'), value); return native('print-pdf', {html, path:target, landscape:value.landscape === true}); },
  'notes-import-notion': async () => {
    const files = await native('open-dialog', { title:'Import Notion export', extensions:['zip'] }); if (!files.length) return null;
    const target = await native('open-dialog', { title:'Choose where to keep imported attachments', directory:true }); if (!target.length) return null;
    const bundle = await (await import('../host/notes/notion-import.mjs')).prepareNotionImport(files[0], path.join(directory,'notes'), { python:runtime.resolvePython(), storageRoot:path.join(target[0],'LocalFlow Notes') });
    return { ...await (await getNotes()).importBundle(bundle), report:bundle.report };
  },
  'notes-skill': async value => { if (handlers.writingBusy) throw new Error('A writing skill is already running.'); handlers.writingBusy = true; try { return await require('../host/notes/skills.cjs').runNoteSkill({ directory, binary:runtime.resolveNiwaCodexBinary, settings:(await getAgent()).snapshot().settings }, value); } finally { handlers.writingBusy = false; } },
  'niwa-select-files': () => native('open-dialog', { title:'Add files to chat', multiple:true }),
  'niwa-add-project': async () => { const files = await native('open-dialog', { title:'Choose a project', directory:true }); return files.length ? (await getAgent()).addProject({ path:files[0] }) : null; },
  'niwa-connect-browser': async () => require('../host/chrome-connection.cjs').connectChrome(await getAgent()),
  close: async () => { closing = true; await agent?.close(); await notes?.close(); transcription.stop(); duplex?.close(); terminateProcess(hotkey); hotkey = null; voice?.stop(); auth.close(); return true; },
};
const agentMethods = {'projects':'projects','open-folder':'openFolder','new-chat':'newChat','select-chat':'selectChat','rename-chat':'renameChat','manage-project':'manageProject','undo-changes':'undoChanges','snapshot':'snapshot','connect':'connect','send':'send','start-voice':'startVoice','disconnect-browser':'disconnectBrowser','stop-voice':'stopVoice','interrupt':'interrupt','configure':'configure','save-connector':'saveConnector','forget':'forget','respond':'respond'};
for (const [channel, method] of Object.entries(agentMethods)) handlers['niwa-'+channel] = async (...args) => (await getAgent())[method](...args);
for (const method of ['list','read','create','save','remove','duplicate','importLegacy','rename','move','trash','restore','history','restoreVersion','databaseRead','databaseSave','databaseAddRow','databaseMoveRow','databaseRunButton','databaseQuery','databasePage','databasePatch','databasePageAction','databaseOptions','databaseExport']) handlers['notes-'+method] = async (...args) => (await getNotes())[method](...args);

createInterface({ input: process.stdin }).on('line', line => {
  let packet; try { packet = JSON.parse(line); } catch { return; }
  if(process.env.LOCALFLOW_DEBUG_BRIDGE)console.error('[host] request',packet.id,packet.method);
  if (packet.nativeId) { const request = nativePending.get(packet.nativeId); if (!request) return; nativePending.delete(packet.nativeId); clearTimeout(request.timer); packet.error ? request.reject(new Error(packet.error)) : request.resolve(packet.value); return; }
  Promise.resolve().then(() => { if (closing && packet.method !== 'close') throw new Error('LocalFlow is closing.'); const handler = handlers[packet.method]; if (typeof handler !== 'function' || !Array.isArray(packet.args)) throw new Error('Unknown LocalFlow operation.'); return handler(...packet.args); })
    .then(value => send({ id:packet.id, value:value ?? null }), error => send({ id:packet.id, error:error.message }));
});
process.stdin.on('end', () => { void handlers.close().finally(() => process.exit()); });
