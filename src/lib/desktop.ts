import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { RecordingOverlayState } from '../types';

const native = (method: string, ...args: unknown[]) => invoke('native_call', { method, args });
const host = (method: string, ...args: unknown[]) => invoke('host_call', { method, args });
function subscribe<T>(event: string, callback: (value: T) => void) {
  let active = true;
  const listener = listen<T>(event, event => { if (active) callback(event.payload); });
  return () => { active = false; void listener.then(stop => stop()); };
}
const hostMethods = {
  transcribeFile:'transcribe-file', cancelTranscription:'cancel-transcription', setWhisperModel:'set-whisper-model', setWhisperLanguage:'set-whisper-language',
  getCleanupAuthStatus:'cleanup-auth-status',getCleanupModels:'get-cleanup-models',setCleanupModel:'set-cleanup-model',connectCleanupWithCodex:'cleanup-auth-connect-codex',connectCleanupWithApiKey:'cleanup-auth-connect-api-key',disconnectCleanup:'cleanup-auth-disconnect',cancelCleanupConnection:'cleanup-auth-cancel',openCleanupAuthBrowser:'cleanup-auth-open-browser',
  getVoiceOutputConfig:'get-voice-output-config',setVoiceOutputModel:'set-voice-output-model',exportText:'export-text',getShortcuts:'get-shortcuts',setShortcutCapture:'set-shortcut-capture',setShortcut:'set-shortcut',pasteText:'paste-text',
  notesList:'notes-list',notesRead:'notes-read',notesCreate:'notes-create',notesSave:'notes-save',notesRemove:'notes-remove',notesImport:'notes-importLegacy',notesRename:'notes-rename',notesMove:'notes-move',notesDatabaseRead:'notes-databaseRead',notesDatabasePage:'notes-databasePage',notesDatabasePatch:'notes-databasePatch',notesDatabasePageAction:'notes-databasePageAction',notesDatabaseOptions:'notes-databaseOptions',notesDatabaseExport:'notes-databaseExport',notesDatabaseSave:'notes-databaseSave',notesDatabaseRunButton:'notes-databaseRunButton',notesDatabaseAddRow:'notes-databaseAddRow',notesDatabaseMoveRow:'notes-databaseMoveRow',notesDuplicate:'notes-duplicate',notesTrash:'notes-trash',notesRestore:'notes-restore',notesHistory:'notes-history',notesRestoreVersion:'notes-restoreVersion',notesImportNotion:'notes-import-notion',notesOpenAsset:'notes-open-asset',notesPickAssets:'notes-pick-assets',notesExportPdf:'notes-export-pdf',notesSkill:'notes-skill',
  niwaProjects:'niwa-projects',niwaAddProject:'niwa-add-project',niwaManageProject:'niwa-manage-project',niwaOpenFolder:'niwa-open-folder',niwaNewChat:'niwa-new-chat',niwaSelectChat:'niwa-select-chat',niwaRenameChat:'niwa-rename-chat',niwaSelectFiles:'niwa-select-files',niwaUndoChanges:'niwa-undo-changes',niwaSnapshot:'niwa-snapshot',niwaConnect:'niwa-connect',niwaConnectBrowser:'niwa-connect-browser',niwaDisconnectBrowser:'niwa-disconnect-browser',niwaSend:'niwa-send',niwaStartVoice:'niwa-start-voice',niwaStopVoice:'niwa-stop-voice',niwaInterrupt:'niwa-interrupt',niwaConfigure:'niwa-configure',niwaSaveConnector:'niwa-save-connector',niwaForget:'niwa-forget',niwaRespond:'niwa-respond',
};
const nativeMethods = { getAppearance:'get-appearance',setAppearance:'set-appearance',selectAudioFile:'select-audio-file',copyText:'copy-text',openPath:'open-path',getEdgeSettings:'get-edge-settings',setEdgeSettings:'set-edge-settings' };
window.localflow = {
  ...Object.fromEntries(Object.entries(hostMethods).map(([name, method]) => [name, (...args: unknown[]) => host(method, ...args)])),
  ...Object.fromEntries(Object.entries(nativeMethods).map(([name, method]) => [name, (...args: unknown[]) => native(method, ...args)])),
  saveAudioBuffer: ({ buffer, extension = '.webm' }: { buffer: ArrayBuffer; extension?: string }) => invoke<string>('save_audio_buffer', buffer, { headers: { 'x-audio-extension': extension } }),
  notesUploadAssets: (files: { name: string; data: Uint8Array }[]) => host('notes-upload-assets', files.map(file => ({ ...file, data: Array.from(file.data) }))),
  setRecordingOverlayState: (value: RecordingOverlayState) => { void native('overlay-state', value).catch(console.error); if (value.starting) void host('recording-start').catch(console.error); },
  ...Object.fromEntries(Object.entries({ onShortcutCaptured:'shortcut-captured',onEdgeAction:'edge-action',onNiwaEvent:'niwa-event',onWindowVisibility:'window-visibility',onRecordingOverlayStop:'recording-overlay-stop',onDictationHotkey:'dictation-hotkey',onWorkerProgress:'worker-progress',onCleanupAuthEvent:'cleanup-auth-event' }).map(([name, event]) => [name, (callback: (value: unknown) => void) => subscribe(event, callback)])),
} as Window['localflow'];

const requests = listen<{ id: number; method: string; args: unknown }>('desktop-request', async ({ payload }) => {
  try {
    if (payload.method !== 'flush') throw new Error('Unknown desktop request.');
    await new Promise<void>((resolve, reject) => {
      const event = new CustomEvent('localflow-save-before-quit', { cancelable: true, detail: { resolve, reject } });
      if (window.dispatchEvent(event)) resolve();
    });
    await invoke('frontend_reply', { id:payload.id, value:true, error:null });
  } catch (error) { await invoke('frontend_reply', { id:payload.id, value:null, error:String(error) }); }
});
void listen<string>('host-error', ({ payload }) => { console.error(payload); window.dispatchEvent(new CustomEvent('localflow-host-error', { detail:payload })); });
document.addEventListener('click', event => {
  const link = (event.target as HTMLElement).closest('a');
  if (link?.href && /^(https?:|mailto:)/.test(link.getAttribute('href') || '')) { event.preventDefault(); void native('open-url', link.href).catch(console.error); }
});
export async function desktopReady() { await requests; await invoke('desktop_ready'); }
export function windowControl(action: 'minimize' | 'maximize' | 'hide') { return native('window-'+action); }
export function startWindowDrag(event: React.PointerEvent) {
  if (event.button === 0 && !(event.target as HTMLElement).closest('button,input,a')) void getCurrentWindow().startDragging();
}
