import {
  FileAudio,
  FolderOpen,
  History,
  Info,
  Keyboard,
  KeyRound,
  Link2,
  LogOut,
  MessageCircle,
  Mic,
  NotebookPen,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { version as APP_VERSION } from '../package.json';
import { ProfileMenu } from "./components/ProfileMenu";
import { PanelResize } from "./components/PanelResize";
import { NotesPage } from "./components/NotesPage";
import { AppearanceSettings } from "./components/AppearanceSettings";
import { TranscribePage, type RecentSession } from "./components/TranscribePage";
import { createAudioRecording, type AudioRecording } from "./lib/audio-recording";
import { EdgeSettings } from './components/EdgeSettings';
import { NiwaAgent } from './components/NiwaAgent';
import { ModelSettings } from './components/ModelSettings';
import { BrowserConnection } from './components/BrowserConnection';
import { ShortcutsPage } from "./components/ShortcutsPage";
import type {
  CleanupLevel,
  CleanupAuthStatus,
  PolishOptions,
  ShortcutConfig,
  TranscriptionLanguage,
  TranscriptResult,
  VoiceOutputConfig,
  VoiceOutputModel,
  WorkerProgress,
} from "./types";

type RunState = "idle" | "starting" | "recording" | "saving" | "ready" | "processing" | "done" | "error";
type NavSection = "transcribe" | "notes" | "niwa" | "files" | "history" | "settings" | "shortcuts" | "about";
type WhisperModelId = "large-v3-turbo" | "large-v3" | "nemo-parakeet-tdt-0.6b-v3" | "nemo-canary-1b-v2";
type HotkeyMode = "hold" | "press";
type RecordingMode = "manual" | "paste" | "notes" | "niwa";
const CLEANUP_LEVEL_STORAGE_KEY = "localflow.cleanup-level.v1";
const HOTKEY_MODE_STORAGE_KEY = "localflow.hotkey-mode.v1";
const cleanupLevels = new Set<CleanupLevel>(["none", "light", "medium", "high"]);

function polishOptions(level: CleanupLevel): PolishOptions {
  return {
    cleanup: level !== "none",
    cleanupLevel: level,
    removeFillers: level !== "none",
    punctuation: level !== "none",
    logicalCorrection: level === "medium" || level === "high",
  };
}

function savedCleanupLevel(): CleanupLevel {
  const saved = window.localStorage.getItem(CLEANUP_LEVEL_STORAGE_KEY);
  return cleanupLevels.has(saved as CleanupLevel) ? saved as CleanupLevel : "none";
}

function savedHotkeyMode(): HotkeyMode {
  return window.localStorage.getItem(HOTKEY_MODE_STORAGE_KEY) === "press" ? "press" : "hold";
}

const defaultConfig = {
  whisperModel: "large-v3-turbo",
  whisperDownloadRoot: "",
  language: "auto",
  outputLanguage: "Original language",
  cleanupEngine: "Codex OAuth",
  cleanupModel: "gpt-5.6-terra",
};

const defaultVoiceOutputConfig: VoiceOutputConfig = {
  model: "piper",
  voiceRoot: "",
  options: [
    {
      id: "piper",
      label: "Piper",
      description: "Brz ženski English glas. Ne zauzima GPU.",
      available: false,
      detail: "Proveravam instalaciju…",
    },
    {
      id: "xtts",
      label: "XTTS",
      description: "CUDA voice cloning sa English Niwa odgovorima.",
      available: false,
      detail: "Proveravam instalaciju…",
    },
    {
      id: "omnivoice",
      label: "OmniVoice",
      description: "CUDA voice cloning sa podrškom za više od 600 jezika.",
      available: false,
      detail: "Proveravam instalaciju…",
    },
    {
      id: "xvasynth",
      label: "xVASynth",
      description: "Character voice engine. Zahteva Steam aplikaciju i voice pack.",
      available: false,
      detail: "Proveravam instalaciju…",
    },
  ],
};

const defaultCleanupAuthStatus: CleanupAuthStatus = {
  connected: false,
  mode: null,
  busy: false,
  stage: "idle",
  message: "Checking cleanup access…",
  deviceCode: null,
  deviceUrl: null,
};

const whisperModelOptions: Array<{
  id: WhisperModelId;
  label: string;
  description: string;
}> = [
  {
    id: "large-v3-turbo",
    label: "large-v3-turbo",
    description: "Fast dictation mode.",
  },
  {
    id: "large-v3",
    label: "large-v3",
    description: "Higher accuracy mode.",
  },
  {
    id: "nemo-parakeet-tdt-0.6b-v3",
    label: "Parakeet TDT 0.6B V3",
    description: "Brz lokalni ONNX model sa automatskim izborom između 25 jezika.",
  },
  {
    id: "nemo-canary-1b-v2",
    label: "Canary 1B V2",
    description: "Precizniji lokalni ONNX model. Srpski koristi najbliži Croatian token.",
  },
];

const transcriptionLanguageOptions: Array<{
  id: TranscriptionLanguage;
  label: string;
  description: string;
}> = [
  { id: "sr", label: "Srpski", description: "Srpski govor, izlaz latinicom." },
  { id: "en", label: "English", description: "English speech and output." },
  { id: "auto", label: "Auto detect", description: "Podržani modeli biraju jezik za svaki snimak." },
];

const hotkeyModeOptions: Array<{
  id: HotkeyMode;
  label: string;
  description: string;
}> = [
  { id: "hold", label: "Hold to speak", description: "Drži shortcut dok govoriš; pusti za slanje." },
  { id: "press", label: "Press to speak", description: "Pritisni za početak; pritisni ponovo za kraj." },
];

const HOTKEY_RELEASE_BUFFER_MS = 450;

const cleanupLevelOptions: Array<{
  id: CleanupLevel;
  label: string;
  description: string;
}> = [
  {
    id: "none",
    label: "None",
    description: "No cloud cleanup pass.",
  },
  {
    id: "light",
    label: "Light",
    description: "Punctuation, pauses, fillers.",
  },
  {
    id: "medium",
    label: "Medium",
    description: "Cleaner logic, same voice.",
  },
  {
    id: "high",
    label: "High",
    description: "Compact intended meaning.",
  },
];

const navItems = [
  { id: "transcribe", label: "Transcribe", icon: Mic },
  { id: "notes", label: "Notes", icon: NotebookPen },
  { id: "niwa", label: "Agents", icon: MessageCircle },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
] satisfies Array<{
  id: NavSection;
  label: string;
  icon: typeof Mic;
}>;

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes.toString().padStart(2, "0")}:${rest}`;
}

function audioExtensionFromMime(mimeType: string) {
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("mp4")) return ".m4a";
  if (mimeType.includes("wav")) return ".wav";
  return ".webm";
}

export function App() {
  const [notesSidebar, setNotesSidebar] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState<RunState>("idle");
  const [audioPath, setAudioPath] = useState("");
  const [audioName, setAudioName] = useState("New transcription");
  const [status, setStatus] = useState("Ready");
  const [options, setOptions] = useState<PolishOptions>(() => polishOptions(savedCleanupLevel()));
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [config, setConfig] = useState(defaultConfig);
  const [activeSection, setActiveSection] = useState<NavSection>("niwa");
  const edgeSectionRef = useRef<NavSection | null>(null);
  const [exportedPath, setExportedPath] = useState("");
  const [error, setError] = useState("");
  const [switchingModel, setSwitchingModel] = useState(false);
  const [switchingLanguage, setSwitchingLanguage] = useState(false);
  const [hotkeyMode, setHotkeyMode] = useState<HotkeyMode>(() => savedHotkeyMode());
  const [switchingVoiceOutput, setSwitchingVoiceOutput] = useState(false);
  const [voiceOutputConfig, setVoiceOutputConfig] = useState<VoiceOutputConfig>(defaultVoiceOutputConfig);
  const [voiceOutputError, setVoiceOutputError] = useState("");
  const [cleanupAuthStatus, setCleanupAuthStatus] = useState<CleanupAuthStatus>(defaultCleanupAuthStatus);
  const [cleanupAuthError, setCleanupAuthError] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [windowVisible, setWindowVisible] = useState(true);
  const [niwaVoice, setNiwaVoice] = useState(false);
  const [niwaMicrophone, setNiwaMicrophone] = useState(false);
  const [niwaListening, setNiwaListening] = useState(false);
  const microphoneOwner = useRef<'niwa' | 'dictation' | null>(null);
  const niwaModeRef = useRef('realtime');
  const [notesCapture, setNotesCapture] = useState<{ id: number; text: string } | null>(null);
  const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig | null>(null);
  const recordingOverlaySeconds = Math.floor(recordingSeconds);

  const mediaRecorderRef = useRef<AudioRecording | null>(null);
  const recordingGeneration = useRef(0);
  const activeRequest = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const hotkeyStopTimerRef = useRef<number | null>(null);
  const hotkeyStopRequestedRef = useRef(false);
  const startedAtRef = useRef(0);
  const optionsRef = useRef(options);
  const stateRef = useRef<RunState>(state);
  const hotkeyRecordingRef = useRef(false);
  const recordingModeRef = useRef<RecordingMode>("manual");
  const recordingHotkeyLabelRef = useRef("");
  const hotkeyModeRef = useRef<HotkeyMode>(hotkeyMode);

  useEffect(() => window.localflow.onWindowVisibility(setWindowVisible), []);
  useEffect(() => window.localflow.onNiwaEvent(event => {
    if (event.type === 'approval') setActiveSection('niwa');
  }), []);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    hotkeyModeRef.current = hotkeyMode;
  }, [hotkeyMode]);

  useEffect(() => {
    if (!window.localflow?.getVoiceOutputConfig) return;
    let active = true;
    window.localflow.getVoiceOutputConfig()
      .then((nextConfig) => {
        if (active) setVoiceOutputConfig(nextConfig);
      })
      .catch((configError) => {
        if (active) setVoiceOutputError(configError instanceof Error ? configError.message : String(configError));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const nextShortcuts = await window.localflow.getShortcuts();
        if (active) setShortcutConfig(nextShortcuts);
      } catch (startupError) {
        if (active) setStatus(startupError instanceof Error ? startupError.message : String(startupError));
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (options.cleanup) window.localflow.getCleanupAuthStatus()
      .then((nextStatus) => {
        if (active) setCleanupAuthStatus(nextStatus);
      })
      .catch((authError) => {
        if (active) setCleanupAuthError(authError instanceof Error ? authError.message : String(authError));
      });
    const unsubscribe = window.localflow.onCleanupAuthEvent((nextStatus) => {
      if (!active) return;
      setCleanupAuthStatus(nextStatus);
      if (nextStatus.stage !== "error") setCleanupAuthError("");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [options.cleanup]);

  useEffect(() => {
    return window.localflow.onWorkerProgress((payload: WorkerProgress) => {
      if (payload.action === "transcribe" && payload.id !== activeRequest.current) return;
      if (payload.config) {
        setConfig((current) => ({ ...current, ...payload.config }));
      }
      if (payload.type === "partial-result" && payload.data?.rawText !== undefined) {
        setResult((current) => ({
          rawText: payload.data?.rawText || "",
          polishedText: current?.polishedText || "",
          language: payload.data?.language,
          duration: payload.data?.duration,
          segments: payload.data?.segments,
        }));
        if (payload.data.duration) {
          setRecordingSeconds(payload.data.duration);
        }
        setStatus(optionsRef.current.cleanupLevel === "none" ? "Transcript ready" : "Raw transcript ready; polishing with Codex");
      }
      if (payload.message) {
        setStatus(payload.message);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      recordingGeneration.current += 1;
      mediaRecorderRef.current?.stop();
      cleanupRecordingResources();
      if (activeRequest.current) void window.localflow.cancelTranscription();
      activeRequest.current = null;
    };
  }, []);

  useEffect(() => {
    return window.localflow.onDictationHotkey((payload) => {
      const action = payload.action || "dictation";
      if (action === "import-audio") {
        if (payload.event === "pressed") void chooseFile();
        return;
      }
      if (action === "reset-session") {
        if (payload.event === "pressed") reset();
        return;
      }
      if (action === 'niwa-agent' && niwaModeRef.current === 'realtime') {
        if (payload.event === 'pressed') setActiveSection('niwa');
        // NiwaAgent handles both edges directly so key release mutes capture immediately.
        return;
      }
      if (microphoneOwner.current === 'niwa') return;
      const mode: RecordingMode = action === 'niwa-agent' ? 'niwa' : 'paste';
      if (payload.event === "pressed") {
        if (action !== 'niwa-agent' && hotkeyModeRef.current === "press" && hotkeyRecordingRef.current) {
          stopRecordingAfterBuffer(0);
          return;
        }
        if (hotkeyStopTimerRef.current !== null) {
          window.clearTimeout(hotkeyStopTimerRef.current);
          hotkeyStopTimerRef.current = null;
        }
        hotkeyStopRequestedRef.current = false;
        if (stateRef.current === "idle" || stateRef.current === "ready" || stateRef.current === "done" || stateRef.current === "error") {
          hotkeyRecordingRef.current = true;
          recordingModeRef.current = mode;
          recordingHotkeyLabelRef.current = payload.hotkey || "";
          if (mode === 'niwa') setActiveSection('niwa');
          void startRecording(mode);
        }
        return;
      }
      if (payload.event === "released" && hotkeyRecordingRef.current && recordingModeRef.current === mode && (action === 'niwa-agent' || hotkeyModeRef.current === "hold")) {
        if (action === 'niwa-agent') {
          if (stateRef.current === 'starting') reset();
          else stopRecording();
        } else stopRecordingAfterBuffer();
      }
    });
  }, []);

  useEffect(() => window.localflow.onEdgeAction(action => {
    if (action === 'notes') { setActiveSection('notes'); return; }
    if (action === 'agent') { setActiveSection('niwa'); return; }
    if (stateRef.current === 'starting') { reset(); return; }
    if (stateRef.current === 'recording') { stopRecording(); return; }
    if (!['saving', 'processing'].includes(stateRef.current) && microphoneOwner.current !== 'niwa') void startRecording('paste');
  }), []);

  const cleanupRecordingResources = () => {
    if (microphoneOwner.current === 'dictation') microphoneOwner.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (hotkeyStopTimerRef.current !== null) {
      window.clearTimeout(hotkeyStopTimerRef.current);
      hotkeyStopTimerRef.current = null;
    }
    hotkeyStopRequestedRef.current = false;
    setAudioStream(null);
  };

  const updateCleanupLevel = (level: CleanupLevel) => {
    window.localStorage.setItem(CLEANUP_LEVEL_STORAGE_KEY, level);
    setOptions(polishOptions(level));
  };

  const updateHotkeyMode = (mode: HotkeyMode) => {
    window.localStorage.setItem(HOTKEY_MODE_STORAGE_KEY, mode);
    setHotkeyMode(mode);
    setStatus(`${mode === "hold" ? "Hold" : "Press"} to speak selected`);
  };

  const transcribePath = async (path: string, name: string) => {
    const previous = activeRequest.current;
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    setAudioPath(path);
    setAudioName(name);
    setState("processing");
    setError("");
    setResult(null);
    setExportedPath("");
    try {
      if (previous) await window.localflow.cancelTranscription();
      if (activeRequest.current !== requestId) return null;
      const data = await window.localflow.transcribeFile({ path, options: optionsRef.current, requestId });
      if (activeRequest.current !== requestId) return null;
      activeRequest.current = null;
      setResult(data);
      setRecentSessions(current => [{ id: requestId, name, path, createdAt: Date.now(), result: data }, ...current].slice(0, 20));
      setRecordingSeconds(data.duration || recordingSeconds);
      setStatus("Transcript ready");
      setState("done");
      return data;
    } catch (transcriptionError) {
      if (activeRequest.current !== requestId) return null;
      activeRequest.current = null;
      const message = transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError);
      setError(message);
      setStatus("Transcription failed");
      setState("error");
      return null;
    }
  };

  const chooseFile = async () => {
    if (mediaRecorderRef.current || hotkeyRecordingRef.current || stateRef.current === "starting") return;
    const generation = ++recordingGeneration.current;
    const selected = await window.localflow.selectAudioFile();
    if (!selected || generation !== recordingGeneration.current) {
      return;
    }
    const name = selected.split(/[\\/]/).pop() || selected;
    await transcribePath(selected, name);
  };

  const saveDroppedFile = async (file: File) => {
    if (mediaRecorderRef.current || hotkeyRecordingRef.current || stateRef.current === "starting") return;
    const generation = ++recordingGeneration.current;
    const buffer = await file.arrayBuffer();
    if (generation !== recordingGeneration.current) return;
    const extension = file.name.includes(".") ? `.${file.name.split(".").pop()}` : audioExtensionFromMime(file.type);
    const savedPath = await window.localflow.saveAudioBuffer({ buffer, extension });
    if (generation !== recordingGeneration.current) return;
    await transcribePath(savedPath, file.name);
  };

  const onDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      await saveDroppedFile(file);
    }
  };

  const startRecording = async (mode: RecordingMode = "manual") => {
    if (mediaRecorderRef.current || stateRef.current === "starting" || microphoneOwner.current === 'niwa') return;
    microphoneOwner.current = 'dictation';
    stateRef.current = "starting";
    setState("starting");
    setStatus("Opening microphone");
    recordingModeRef.current = mode;
    const generation = ++recordingGeneration.current;
    try {
      setError("");
      setResult(null);
      setExportedPath("");
      setRecordingSeconds(0);
      const recorder = await createAudioRecording((stream) => {
        if (generation === recordingGeneration.current) setAudioStream(stream);
      });
      if (generation !== recordingGeneration.current) { recorder.stop(); return; }
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
      stateRef.current = "recording";
      setState("recording");
      setStatus("Recording");
      if (mode !== "manual" && hotkeyStopRequestedRef.current && hotkeyStopTimerRef.current === null) stopRecordingAfterBuffer();
      const blob = await recorder.complete;
      if (generation !== recordingGeneration.current) return;
      mediaRecorderRef.current = null;
      cleanupRecordingResources();
      setState("saving");
      setStatus("Saving local recording");
      const buffer = await blob.arrayBuffer();
      const extension = audioExtensionFromMime(blob.type);
      const savedPath = await window.localflow.saveAudioBuffer({ buffer, extension });
      if (generation !== recordingGeneration.current) return;
      const name = `Recording ${new Date().toLocaleTimeString()}`;
      const data = await transcribePath(savedPath, name);
      if (generation !== recordingGeneration.current) return;
      const completedMode = recordingModeRef.current;
      if (completedMode === "paste" && data) {
        const text = data.polishedText || data.rawText;
        if (text) {
          await window.localflow.pasteText(text);
          setStatus("Pasted transcript");
        }
      } else if (completedMode === 'niwa' && data) {
        const text = data.polishedText || data.rawText;
        if (text) { setActiveSection('niwa'); await window.localflow.niwaSend(text); }
      } else if (completedMode === "notes" && data) {
        const text = (data.polishedText || data.rawText || "").trim();
        if (text) {
          setNotesCapture({ id: Date.now(), text });
          setActiveSection("notes");
          setStatus("Saving voice transcript to note");
        }
      }
      hotkeyRecordingRef.current = false;
      recordingModeRef.current = "manual";
      recordingHotkeyLabelRef.current = "";
    } catch (recordingError) {
      if (generation !== recordingGeneration.current) return;
      mediaRecorderRef.current = null;
      cleanupRecordingResources();
      hotkeyRecordingRef.current = false;
      hotkeyStopRequestedRef.current = false;
      const message = recordingError instanceof Error ? recordingError.message : String(recordingError);
      setError(`Microphone recording failed: ${message}`);
      setStatus("Recording failed");
      setState("error");
    }
  };

  const stopRecording = () => {
    if (hotkeyStopTimerRef.current !== null) {
      window.clearTimeout(hotkeyStopTimerRef.current);
      hotkeyStopTimerRef.current = null;
    }
    hotkeyStopRequestedRef.current = false;
    if (mediaRecorderRef.current) {
      setStatus("Stopping");
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
  };

  const stopRecordingAfterBuffer = (delay = HOTKEY_RELEASE_BUFFER_MS) => {
    hotkeyStopRequestedRef.current = true;
    if (hotkeyStopTimerRef.current !== null) {
      return;
    }
    setStatus("Finishing phrase");
    const attemptStop = () => {
      hotkeyStopTimerRef.current = null;
      if (mediaRecorderRef.current) {
        stopRecording();
        return;
      }
    };
    hotkeyStopTimerRef.current = window.setTimeout(attemptStop, delay);
  };

  useEffect(() => {
    const sectionChanged = edgeSectionRef.current !== activeSection;
    edgeSectionRef.current = activeSection;
    window.localflow.setRecordingOverlayState({
      recording: state === "recording",
      starting: state === "starting",
      agentListening: niwaListening || (state === 'recording' && recordingModeRef.current === 'niwa'),
      recordingTarget: recordingModeRef.current === 'niwa' ? 'agent' : 'microphone',
      elapsedSeconds: recordingOverlaySeconds,
      selected: !sectionChanged ? undefined : activeSection === 'niwa' ? 'agent' : activeSection === 'notes' ? 'notes' : activeSection === 'transcribe' ? 'microphone' : undefined,
    });
  }, [state, recordingOverlaySeconds, activeSection, niwaListening]);

  useEffect(() => {
    return window.localflow.onRecordingOverlayStop(() => {
      if (stateRef.current === "starting") { reset(); return; }
      if (stateRef.current !== "recording") return;
      hotkeyRecordingRef.current = false;
      stopRecording();
    });
  }, []);

  const runTranscription = async () => {
    if (!audioPath) {
      setStatus("Record or import audio first");
      return;
    }
    await transcribePath(audioPath, audioName);
  };

  const copyText = async (text?: string) => {
    if (!text) return;
    try {
      await window.localflow.copyText(text);
      setStatus("Copied");
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
      setStatus("Copy failed");
    }
  };

  const exportText = async (text?: string, defaultName = "localflow-transcript.txt") => {
    if (!text) {
      return;
    }
    try {
      const saved = await window.localflow.exportText({ text, defaultName });
      if (saved) {
        setExportedPath(saved);
        setStatus("Exported");
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
      setStatus("Export failed");
    }
  };

  const reset = () => {
    recordingGeneration.current += 1;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (activeRequest.current) void window.localflow.cancelTranscription();
    activeRequest.current = null;
    hotkeyRecordingRef.current = false;
    cleanupRecordingResources();
    setState("idle");
    setAudioPath("");
    setAudioName("New transcription");
    setResult(null);
    setExportedPath("");
    setError("");
    setRecordingSeconds(0);
    setStatus("Ready");
  };

  const openSession = (session: RecentSession) => {
    if (stateRef.current === "recording" || activeRequest.current) return;
    setAudioPath(session.path); setAudioName(session.name); setResult(session.result);
    setRecordingSeconds(session.result.duration || 0); setState("done"); setStatus("Transcript ready");
    setError(""); setActiveSection("transcribe");
  };

  const isBusy = niwaMicrophone || state === "starting" || state === "processing" || state === "saving" || switchingModel || switchingLanguage || switchingVoiceOutput;
  const activeNavItem = navItems.find((item) => item.id === activeSection) || navItems[0];
  const pageTitle = activeNavItem.label;

  const switchWhisperModel = async (model: WhisperModelId) => {
    if (model === config.whisperModel || state === "recording" || switchingModel) {
      return;
    }
    setSwitchingModel(true);
    setError("");
    setStatus(`Loading STT model ${model}`);
    try {
      const nextConfig = await window.localflow.setWhisperModel(model);
      setConfig((current) => ({ ...current, ...nextConfig }));
      setStatus(`${model} ready`);
    } catch (modelError) {
      const message = modelError instanceof Error ? modelError.message : String(modelError);
      setError(message);
      setStatus("Model switch failed");
    } finally {
      setSwitchingModel(false);
    }
  };

  const switchWhisperLanguage = async (language: TranscriptionLanguage) => {
    if (language === config.language || state === "recording" || switchingLanguage) return;
    const option = transcriptionLanguageOptions.find((candidate) => candidate.id === language);
    setSwitchingLanguage(true);
    setError("");
    setStatus(`Selecting ${option?.label || language}`);
    try {
      const nextConfig = await window.localflow.setWhisperLanguage(language);
      setConfig((current) => ({ ...current, ...nextConfig }));
      setStatus(`${option?.label || language} transcription ready`);
    } catch (languageError) {
      setError(languageError instanceof Error ? languageError.message : String(languageError));
      setStatus("Language switch failed");
    } finally {
      setSwitchingLanguage(false);
    }
  };

  const switchVoiceOutputModel = async (model: VoiceOutputModel) => {
    if (model === voiceOutputConfig.model || switchingVoiceOutput) return;
    const option = voiceOutputConfig.options.find((candidate) => candidate.id === model);
    if (!option || (!option.available && model === "xvasynth")) return;
    setSwitchingVoiceOutput(true);
    setVoiceOutputError("");
    setStatus(`Selecting ${option.label}`);
    try {
      const nextConfig = await window.localflow.setVoiceOutputModel(model);
      setVoiceOutputConfig(nextConfig);
      setStatus(`${option.label} selected for Niwa voice output`);
    } catch (voiceError) {
      const message = voiceError instanceof Error ? voiceError.message : String(voiceError);
      setVoiceOutputError(message);
      setStatus("Voice output switch failed");
    } finally {
      setSwitchingVoiceOutput(false);
    }
  };

  const connectCleanupWithCodex = () => {
    setCleanupAuthError("");
    void window.localflow.connectCleanupWithCodex().catch((authError) => {
      setCleanupAuthError(authError instanceof Error ? authError.message : String(authError));
    });
  };

  const connectCleanupWithApiKey = () => {
    const apiKey = openAiApiKey.trim();
    setCleanupAuthError("");
    setOpenAiApiKey("");
    void window.localflow.connectCleanupWithApiKey(apiKey).catch((authError) => {
      setCleanupAuthError(authError instanceof Error ? authError.message : String(authError));
    });
  };

  const disconnectCleanup = () => {
    setCleanupAuthError("");
    void window.localflow.disconnectCleanup()
      .then(setCleanupAuthStatus)
      .catch((authError) => setCleanupAuthError(authError instanceof Error ? authError.message : String(authError)));
  };

  const cancelCleanupConnection = () => {
    void window.localflow.cancelCleanupConnection().then(setCleanupAuthStatus);
  };

  const cleanupAccessLabel = cleanupAuthStatus.busy
    ? cleanupAuthStatus.stage === "device-code" ? "Connecting Codex" : "Checking API key"
    : cleanupAuthStatus.connected
      ? cleanupAuthStatus.mode === "api-key" ? "OpenAI API key" : "Codex account"
      : "Not connected";

  const renderUtilityView = () => {
    if (activeSection === 'niwa') return null;

    if (activeSection === "files") {
      return (
        <section className="utilityPanel">
          <header>
            <FolderOpen size={24} />
            <div>
              <h2>Files</h2>
              <p>Import audio files and inspect the current local session.</p>
            </div>
          </header>
          <div className="utilityActions">
            <button onClick={chooseFile} disabled={isBusy || state === "recording"}>
              <Upload size={18} /> Import audio
            </button>
            <button onClick={() => setActiveSection("transcribe")}>
              <Mic size={18} /> Open recorder
            </button>
          </div>
          <div className="infoGrid">
            <div>
              <small>Current audio</small>
              <strong>{audioPath ? audioName : "No audio loaded"}</strong>
            </div>
            <div>
              <small>Audio path</small>
              <strong>{audioPath || "Import or record audio first"}</strong>
            </div>
            <div>
              <small>Last export</small>
              <strong>{exportedPath || "Nothing exported yet"}</strong>
            </div>
          </div>
        </section>
      );
    }

    if (activeSection === "history") {
      return (
        <section className="utilityPanel">
          <header>
            <History size={24} />
            <div>
              <h2>History</h2>
              <p>Return to recordings from this app session.</p>
            </div>
          </header>
          <div className="historyList">
            {recentSessions.map(session => <article key={session.id}>
              <FileAudio size={20} /><div><strong>{session.name}</strong><small>{new Date(session.createdAt).toLocaleString()} � {formatDuration(session.result.duration || 0)}</small></div>
              <button onClick={() => openSession(session)} disabled={isBusy || state === "recording"}>Open</button>
            </article>)}
            {!recentSessions.length && <div className="emptyNiwaState"><History size={28} /><strong>No recordings yet.</strong><span>Your completed recordings will be listed here.</span></div>}
          </div>
        </section>
      );
    }

    if (activeSection === "settings") {
      return (
        <section className="utilityPanel">
          <header>
            <Settings size={24} />
            <div>
              <h2>Settings</h2>
            </div>
          </header>
          <div className="settingsList">
            <AppearanceSettings />
            <EdgeSettings />
            <div className="settingsGroup cleanupAuthGroup">
              <div className="settingsGroupHeading">
                <strong>Cleanup access</strong>
              </div>
              <div className="cleanupAuthStatusRow">
                <span className={`cleanupAuthDot ${cleanupAuthStatus.connected ? "connected" : ""}`} />
                <div>
                  <strong>{cleanupAccessLabel}</strong>
                  <span>{cleanupAuthStatus.message}</span>
                </div>
                {cleanupAuthStatus.connected ? (
                  <button className="cleanupAuthDisconnect" onClick={disconnectCleanup} disabled={cleanupAuthStatus.busy}>
                    <LogOut size={14} /> Disconnect
                  </button>
                ) : null}
              </div>
              <div className="cleanupAuthMethods">
                <article className="cleanupAuthMethod">
                  <div className="cleanupAuthMethodHeading">
                    <span><Link2 size={16} /></span>
                    <div>
                      <strong>Connect with Codex</strong>
                      <small>Use your ChatGPT subscription in a secure browser flow.</small>
                    </div>
                  </div>
                  {cleanupAuthStatus.deviceCode ? (
                    <div className="cleanupDeviceCode">
                      <small>One-time code · copied</small>
                      <strong>{cleanupAuthStatus.deviceCode}</strong>
                      <button onClick={() => window.localflow.openCleanupAuthBrowser()}>Open browser again</button>
                    </div>
                  ) : null}
                  {cleanupAuthStatus.busy && cleanupAuthStatus.stage === "device-code" ? (
                    <button className="cleanupAuthButton secondary" onClick={cancelCleanupConnection}>
                      <X size={15} /> Cancel
                    </button>
                  ) : (
                    <button className="cleanupAuthButton" onClick={connectCleanupWithCodex} disabled={cleanupAuthStatus.busy}>
                      <Link2 size={15} /> {cleanupAuthStatus.connected ? "Reconnect Codex" : "Connect with Codex"}
                    </button>
                  )}
                </article>

                <article className="cleanupAuthMethod">
                  <div className="cleanupAuthMethodHeading">
                    <span><KeyRound size={16} /></span>
                    <div>
                      <strong>OpenAI API key</strong>
                      <small>Use API billing instead of a ChatGPT subscription.</small>
                    </div>
                  </div>
                  <label className="cleanupApiKeyField">
                    <span>API key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-…"
                      value={openAiApiKey}
                      onChange={(event) => setOpenAiApiKey(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && openAiApiKey.trim() && !cleanupAuthStatus.busy) connectCleanupWithApiKey();
                      }}
                      disabled={cleanupAuthStatus.busy}
                    />
                  </label>
                  <button
                    className="cleanupAuthButton"
                    onClick={connectCleanupWithApiKey}
                    disabled={cleanupAuthStatus.busy || !openAiApiKey.trim()}
                  >
                    <KeyRound size={15} /> Connect API key
                  </button>
                  <small className="cleanupAuthPrivacy">LocalFlow ne čuva ključ. Prosleđuje ga direktno Codex credential store-u.</small>
                </article>
              </div>
              {cleanupAuthError ? <div className="errorBox">{cleanupAuthError}</div> : null}
            </div>

            <BrowserConnection disabled={isBusy || state === 'recording'} />
            <div className="settingsGroup">
              <div className="settingsGroupHeading">
                <strong>Transcription language</strong>
              </div>
              <div className="modelSwitch">
                {transcriptionLanguageOptions.map((option) => (
                  <button
                    key={option.id}
                    className={config.language === option.id ? "active" : ""}
                    disabled={switchingLanguage || state === "recording"}
                    onClick={() => switchWhisperLanguage(option.id)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settingsGroup">
              <div className="settingsGroupHeading">
                <strong>Shortcut recording mode</strong>
              </div>
              <div className="modelSwitch">
                {hotkeyModeOptions.map((option) => (
                  <button
                    key={option.id}
                    className={hotkeyMode === option.id ? "active" : ""}
                    disabled={state === "recording"}
                    onClick={() => updateHotkeyMode(option.id)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settingsGroup">
              <div className="settingsGroupHeading">
                <strong>Transcription model</strong>
              </div>
              <div className="modelSwitch">
                {whisperModelOptions.map((model) => (
                  <button
                    key={model.id}
                    className={model.id === config.whisperModel ? "active" : ""}
                    disabled={switchingModel || state === "recording"}
                    onClick={() => switchWhisperModel(model.id)}
                    title={model.description}
                  >
                    <strong>{model.label}</strong>
                    <span>{model.description}</span>
                  </button>
                ))}
              </div>
              <div className="infoGrid settingsInfoGrid">
                <div>
                  <small>STT model cache</small>
                  <strong>{config.whisperDownloadRoot || "X:\\stt-models"}</strong>
                </div>
                <div>
                  <small>Cleanup model</small>
                  <strong>{config.cleanupModel}</strong>
                </div>
                <div>
                  <small>Cleanup access</small>
                  <strong>{cleanupAccessLabel}</strong>
                </div>
                <div>
                  <small>Runtime</small>
                  <strong>X:\wORK cODEX\localflow\runtime</strong>
                </div>
              </div>
            </div>

            <ModelSettings visible={activeSection === 'settings'} disabled={isBusy || state === 'recording'} onModel={cleanupModel => setConfig(current => ({ ...current, cleanupModel }))} />
            <div className="settingsGroup">
              <div className="settingsGroupHeading">
                <strong>Cleanup & formatting</strong>
              </div>
              <div className="cleanupLevelGrid settingsCleanupGrid">
                {cleanupLevelOptions.map((level) => (
                  <button
                    key={level.id}
                    className={options.cleanupLevel === level.id ? "active" : ""}
                    onClick={() => updateCleanupLevel(level.id)}
                    disabled={isBusy || state === "recording"}
                  >
                    <strong>{level.label}</strong>
                    <span>{level.description}</span>
                  </button>
                ))}
              </div>
              <div className="settingsProcessingGrid">
                <label className="rangeRow">
                  <span>Temperature <Info size={14} /></span>
                  <input type="range" min="0" max="1" step="0.1" value="0.2" readOnly />
                  <strong>0.2</strong>
                </label>
                <label className="rangeRow">
                  <span>Beam size <Info size={14} /></span>
                  <input type="range" min="1" max="8" value="5" readOnly />
                  <strong>5</strong>
                </label>
              </div>
            </div>

            <div className="settingsGroup">
              <div className="settingsGroupHeading">
                <strong>Niwa voice output</strong>
              </div>
              <div className="modelSwitch voiceOutputSwitch">
                {voiceOutputConfig.options.map((option) => (
                  <button
                    key={option.id}
                    className={voiceOutputConfig.model === option.id ? "active" : ""}
                    onClick={() => switchVoiceOutputModel(option.id)}
                    disabled={(!option.available && option.id === "xvasynth") || switchingVoiceOutput || niwaVoice}
                    title={option.detail}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                    <small>{option.available ? option.detail : `Nije spreman · ${option.detail}`}</small>
                  </button>
                ))}
              </div>
              <div className="voiceOutputPath">Modeli: {voiceOutputConfig.voiceRoot}</div>
              {voiceOutputError ? <div className="errorBox">{voiceOutputError}</div> : null}
            </div>
          </div>
        </section>
      );
    }

    if (activeSection === "shortcuts") {
      return (
        <ShortcutsPage config={shortcutConfig} onChange={setShortcutConfig} onStatus={setStatus} />
      );
    }

    return (
      <section className="utilityPanel">
        <header>
          <Info size={24} />
          <div>
            <h2>About</h2>
            <p>Local transcription, Codex cleanup and the Niwa voice assistant.</p>
          </div>
        </header>
        <div className="infoGrid">
          <div>
            <small>Version</small>
            <strong>{APP_VERSION}</strong>
          </div>
          <div>
            <small>Privacy</small>
            <strong>Dictation audio stays local · Codex cleanup and duplex voice use the cloud</strong>
          </div>
          <div>
            <small>Storage</small>
            <strong>X:\wORK cODEX\localflow</strong>
          </div>
        </div>
      </section>
    );
  };

  const renderNavItem = (item: typeof navItems[number]) => {
    const Icon = item.icon;
    const active = item.id === activeSection;
    return <button className={`navItem ${active ? "active" : ""}`} key={item.id} data-section={item.id}
      onClick={(event) => { setActiveSection(item.id); event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover(); }} aria-current={active ? "page" : undefined} aria-label={item.label} title={item.label}>
      <Icon size={17} /><span>{item.label}</span>
    </button>;
  };

  return <main className="appShell">
      <div className="windowDragRegion" aria-hidden="true" />
      <aside className="sidebar">
        <PanelResize label="Resize folders" property="--sidebar-width" edge="right" min={180} max={480} fraction={0.35} />
        <div className="brand">
          <img className="brandLogo" src="./localflow-logo.png" width="28" height="28" alt="" aria-hidden="true" />
          <strong>LocalFlow</strong>
        </div>
        <nav className="navList" aria-label="Workspace">{["niwa", "notes"].map(id => renderNavItem(navItems.find(item => item.id === id)!))}</nav>
        <div className="sidebarNotes" ref={setNotesSidebar} />
        <div className="sidebarBottom">
          <ProfileMenu version={APP_VERSION}>{navItems.filter(item => !["niwa", "notes"].includes(item.id)).map(renderNavItem)}</ProfileMenu>
        </div>
      </aside>
      <section className="workspace">
        <header className="workspaceHeader"><strong>{pageTitle}</strong></header>
        <NiwaAgent sidebar={notesSidebar} visible={activeSection === 'niwa'} shortcutLabel={shortcutConfig?.['niwa-agent']?.label || 'Ctrl + Caps Lock'}
          recording={state === 'recording' && recordingModeRef.current === 'niwa'}
          microphoneBusy={state === 'recording' || state === 'starting'}
          claimMicrophone={() => {
            if (microphoneOwner.current === 'dictation') return false;
            microphoneOwner.current = 'niwa'; setNiwaMicrophone(true); return true;
          }}
          releaseMicrophone={() => {
            if (microphoneOwner.current === 'niwa') { microphoneOwner.current = null; setNiwaMicrophone(false); }
          }}
          onVoiceActive={setNiwaVoice}
          onListening={setNiwaListening}
          onMode={mode => { niwaModeRef.current = mode; }}
          onLocalRecord={() => state === 'recording' && recordingModeRef.current === 'niwa' ? stopRecording() : void startRecording('niwa')} />
        <NotesPage sidebar={notesSidebar} visible={activeSection === "notes"} onOpen={() => setActiveSection("notes")}
          capture={notesCapture} onCaptureHandled={() => setNotesCapture(null)} onStatus={setStatus}
          recording={state === "recording" && recordingModeRef.current === "notes"}
          recordDisabled={isBusy || (state === "recording" && recordingModeRef.current !== "notes")}
          onToggleRecording={() => state === "recording" && recordingModeRef.current === "notes" ? stopRecording() : void startRecording("notes")}
        />
        {activeSection === "transcribe" ? <TranscribePage
          result={result} name={audioName} state={state} status={status} error={error}
          seconds={recordingSeconds} stream={audioStream} visible={windowVisible} busy={isBusy} hasAudio={Boolean(audioPath)}
          model={config.whisperModel} language={config.language as TranscriptionLanguage} cleanup={options.cleanupLevel}
          shortcut={shortcutConfig?.dictation?.label || "Ctrl + Shift"} hold={hotkeyMode === "hold"} sessions={recentSessions}
          onLanguage={language => void switchWhisperLanguage(language)} onCleanup={updateCleanupLevel}
          onRecord={() => void startRecording()} onStop={stopRecording} onReset={reset} onImport={() => void chooseFile()} onRetry={() => void runTranscription()}
          onCopy={text => void copyText(text)} onExport={(text, name) => void exportText(text, name)}
          onSaveNote={() => { const text = (options.cleanupLevel !== "none" && result?.polishedText) || result?.rawText; if (text) { setNotesCapture({ id: Date.now(), text }); setActiveSection("notes"); } }}
          onHistory={() => setActiveSection("history")} onOpenSession={openSession} onDrop={onDrop}
        /> : activeSection === "notes" ? null : renderUtilityView()}
      </section>
    </main>;
}
