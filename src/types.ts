import type { NotesIndex, NoteNode, MarkdownNote, Projects, ProjectFolder } from './lib/workspace';
import type { NiwaSettings, NiwaSnapshot, NiwaEvent, NiwaMemory, NiwaModel } from './lib/niwa';
export type CleanupLevel = "none" | "light" | "medium" | "high";
export type TranscriptionLanguage = "sr" | "en" | "auto";

export type PolishOptions = {
  cleanup: boolean;
  cleanupLevel: CleanupLevel;
  removeFillers: boolean;
  punctuation: boolean;
  logicalCorrection: boolean;
};

export type TranscriptResult = {
  rawText: string;
  polishedText: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
};

export type WorkerProgress = {
  id?: string;
  action?: string;
  type: string;
  stage?: string;
  message?: string;
  data?: Partial<TranscriptResult>;
  config?: {
    whisperModel: string;
    whisperDownloadRoot?: string;
    language: TranscriptionLanguage;
    outputLanguage?: string;
    cleanupEngine: string;
    cleanupModel: string;
  };
};

export type RecordingOverlayState = {
  selected?: 'agent' | 'microphone' | 'notes';
  recordingTarget?: 'agent' | 'microphone';
  agentListening?: boolean;
  recording: boolean;
  starting?: boolean;
  elapsedSeconds: number;
};

export type ShortcutAction = 'dictation' | 'import-audio' | 'reset-session' | 'niwa-agent';

export type ShortcutBinding = {
  keys: number[];
  label: string;
};

export type ShortcutConfig = Partial<Record<ShortcutAction, ShortcutBinding>>;

export type AppearanceTheme = "dark" | "light" | "static-black" | "static-white";

export type VoiceOutputModel = "xtts" | "xvasynth" | "piper" | "omnivoice";

export type VoiceOutputConfig = {
  model: VoiceOutputModel;
  voiceRoot: string;
  options: Array<{
    id: VoiceOutputModel;
    label: string;
    description: string;
    available: boolean;
    detail: string;
  }>;
};

export type CleanupAuthStatus = {
  connected: boolean;
  mode: "codex" | "api-key" | null;
  busy: boolean;
  stage: "idle" | "device-code" | "api-key" | "connected" | "error";
  message: string;
  deviceCode: string | null;
  deviceUrl: string | null;
};

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }

  interface Window {
    localflow: {
      getAppearance: () => Promise<AppearanceTheme>;
      setAppearance: (theme: AppearanceTheme) => Promise<AppearanceTheme>;
      selectAudioFile: () => Promise<string | null>;
      saveAudioBuffer: (payload: { buffer: ArrayBuffer; extension?: string }) => Promise<string>;
      transcribeFile: (payload: { path: string; options: PolishOptions; requestId?: string }) => Promise<TranscriptResult>;
      cancelTranscription: () => Promise<void>;
      setWhisperModel: (model: "large-v3-turbo" | "large-v3" | "nemo-parakeet-tdt-0.6b-v3" | "nemo-canary-1b-v2") => Promise<{ whisperModel: string; whisperDownloadRoot?: string }>;
      setWhisperLanguage: (language: TranscriptionLanguage) => Promise<{ language: TranscriptionLanguage; outputLanguage: string }>;
      getCleanupAuthStatus: () => Promise<CleanupAuthStatus>;
      getCleanupModels: () => Promise<{ selected: string; models: { id: string; label: string }[]; error: string }>;
      setCleanupModel: (model: string) => Promise<string>;
      connectCleanupWithCodex: () => Promise<CleanupAuthStatus>;
      connectCleanupWithApiKey: (apiKey: string) => Promise<CleanupAuthStatus>;
      disconnectCleanup: () => Promise<CleanupAuthStatus>;
      cancelCleanupConnection: () => Promise<CleanupAuthStatus>;
      openCleanupAuthBrowser: () => Promise<CleanupAuthStatus>;
      getVoiceOutputConfig: () => Promise<VoiceOutputConfig>;
      setVoiceOutputModel: (model: VoiceOutputModel) => Promise<VoiceOutputConfig>;
      exportText: (payload: { text: string; defaultName?: string }) => Promise<string | null>;
      copyText: (text: string) => Promise<boolean>;
      getShortcuts: () => Promise<ShortcutConfig>;
      setShortcutCapture: (active: boolean) => Promise<void>;
      onShortcutCaptured: (callback: (binding: ShortcutBinding) => void) => () => void;
      setShortcut: (payload: { action: ShortcutAction; binding: ShortcutBinding }) => Promise<ShortcutConfig>;
      openPath: (filePath: string) => Promise<string>;
      pasteText: (text: string) => Promise<boolean>;
      getEdgeSettings: () => Promise<{ enabled: boolean; autoHide: boolean }>;
      setEdgeSettings: (value: { enabled: boolean; autoHide: boolean }) => Promise<{ enabled: boolean; autoHide: boolean }>;
      onEdgeAction: (callback: (action: 'agent' | 'microphone' | 'notes') => void) => () => void;
      notesList: () => Promise<NotesIndex>;
      notesSkill: (value: { skill: string; text: string; prompt?: string }) => Promise<string>;
      notesImportNotion: () => Promise<(NotesIndex & { alreadyImported?: boolean; report: { pages: number; databases: number; rows: number; warnings: unknown[] } }) | null>;
      notesOpenAsset: (url: string) => Promise<void>;
      notesPickAssets: () => Promise<{name:string;url:string;mime:string;size:number}[]>;
      notesUploadAssets: (files:{name:string;data:Uint8Array}[]) => Promise<{name:string;url:string;mime:string;size:number}[]>;
      notesExportPdf: (value:{title:string;html:string;landscape?:boolean}) => Promise<string|null>;
      notesDuplicate: (value:{id:string;parentId?:string}) => Promise<NoteNode>;
      notesDatabaseMoveRow: (value:{id:string;rowId:string;targetId:string;revision:string}) => Promise<import('./lib/database').NotesDatabase>;
      notesRead: (id: string) => Promise<MarkdownNote>;
      notesImport: (items: unknown[]) => Promise<NotesIndex>;
      notesCreate: (value: { kind?: 'folder' | 'note' | 'database'; label: string; parentId?: string; content?: string; document?: import('@tiptap/core').JSONContent; html?: string }) => Promise<MarkdownNote | NoteNode>;
      notesSave: (value: Pick<MarkdownNote,'id'|'label'|'content'|'revision'|'document'|'html'>) => Promise<MarkdownNote>;
      notesRemove: (id: string) => Promise<NotesIndex>;
      notesRename: (value: { id: string; label: string }) => Promise<NotesIndex>;
      notesMove: (value: { id: string; parentId?: string; beforeId?:string }) => Promise<NotesIndex>;
      notesDatabaseRead: (id: string) => Promise<import('./lib/database').NotesDatabase>;
      notesDatabaseSave: (value: import('./lib/database').NotesDatabase) => Promise<import('./lib/database').NotesDatabase>;
      notesDatabaseRunButton: (value: {id:string;rowId:string;propertyId:string;revision:string}) => Promise<import('./lib/database').NotesDatabase>;
      notesDatabaseAddRow: (value: { id: string; label?: string; values?: Record<string, unknown>; templateId?:string }) => Promise<import('./lib/database').NotesDatabase>;
      niwaProjects: () => Promise<Projects>;
      niwaAddProject: () => Promise<ProjectFolder | null>;
      niwaManageProject: (value: { kind: 'project' | 'chat'; id: string; action: 'archive' | 'restore' | 'delete' }) => Promise<Projects>;
      niwaOpenFolder: (id: string) => Promise<Projects>;
      niwaNewChat: (folderId: string) => Promise<Projects>;
      niwaSelectChat: (id: string) => Promise<Projects>;
      niwaRenameChat: (value: { id: string; label: string }) => Promise<Projects>;
      niwaSelectFiles: () => Promise<string[]>;
      niwaUndoChanges: (diff: string) => Promise<void>;
      niwaSnapshot: () => Promise<NiwaSnapshot>;
      niwaConnect: () => Promise<{ models: NiwaModel[]; settings: NiwaSettings }>;
      niwaConnectBrowser: () => Promise<{ mode: 'chrome' | 'bundled'; connected: boolean }>;
      niwaDisconnectBrowser: () => Promise<{ mode: 'chrome' | 'bundled'; connected: boolean }>;
      niwaSend: (text: string) => Promise<void>;
      niwaStartVoice: (sdp: string) => Promise<void>;
      niwaStopVoice: () => Promise<void>;
      niwaInterrupt: () => Promise<void>;
      niwaConfigure: (patch: Partial<NiwaSettings>) => Promise<NiwaSettings>;
      niwaSaveConnector: (config: unknown) => Promise<NiwaSnapshot['connectors']>;
      niwaForget: (id: string) => Promise<NiwaMemory>;
      niwaRespond: (id: string, answer: unknown) => Promise<void>;
      onNiwaEvent: (callback: (event: NiwaEvent) => void) => () => void;
      setRecordingOverlayState: (state: RecordingOverlayState) => void;
      onWindowVisibility: (callback: (visible: boolean) => void) => () => void;
      onRecordingOverlayStop: (callback: () => void) => () => void;
      onDictationHotkey: (callback: (payload: {
        type: "hotkey";
        event: "pressed" | "released";
        action?: ShortcutAction;
        hotkey?: string;
      }) => void) => () => void;
      onWorkerProgress: (callback: (payload: WorkerProgress) => void) => () => void;
      onCleanupAuthEvent: (callback: (status: CleanupAuthStatus) => void) => () => void;
    };
  }
}
