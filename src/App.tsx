import {
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Cpu,
  FileAudio,
  FileDown,
  FolderOpen,
  History,
  Info,
  Keyboard,
  Mic,
  Pencil,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Square,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CleanupLevel, PolishOptions, TranscriptResult, WorkerProgress } from "./types";

type RunState = "idle" | "recording" | "saving" | "ready" | "processing" | "done" | "error";
type NavSection = "transcribe" | "files" | "history" | "models" | "settings" | "shortcuts" | "about";
type WhisperModelId = "large-v3-turbo" | "large-v3";

const initialOptions: PolishOptions = {
  cleanup: false,
  cleanupLevel: "none",
  removeFillers: false,
  punctuation: false,
  logicalCorrection: false,
};

const defaultConfig = {
  whisperModel: "large-v3",
  whisperDownloadRoot: "X:\\stt-models",
  language: "sr",
  outputLanguage: "Serbian Latin",
  ollamaModel: "qwen3:8b",
  ollamaUrl: "http://127.0.0.1:11434",
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
];

const HOTKEY_RELEASE_BUFFER_MS = 450;
const RECORDER_CHUNK_MS = 100;

const cleanupLevelOptions: Array<{
  id: CleanupLevel;
  label: string;
  description: string;
}> = [
  {
    id: "none",
    label: "None",
    description: "No local LLM pass.",
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
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "history", label: "History", icon: History },
  { id: "models", label: "Models", icon: Cpu },
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

function makeIdleLevels() {
  return Array.from({ length: 128 }, (_, index) => 0.18 + ((index * 19) % 55) / 100);
}

function Waveform({ levels, state }: { levels: number[]; state: RunState }) {
  return (
    <div className="waveform" aria-label="Audio waveform">
      {levels.map((level, index) => (
        <span
          key={index}
          className={state === "recording" ? "liveBar" : ""}
          style={{ height: `${Math.max(8, Math.round(level * 96))}px` }}
        />
      ))}
    </div>
  );
}

export function App() {
  const [state, setState] = useState<RunState>("idle");
  const [audioPath, setAudioPath] = useState("");
  const [audioName, setAudioName] = useState("New transcription");
  const [status, setStatus] = useState("Ready");
  const [options, setOptions] = useState<PolishOptions>(initialOptions);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [config, setConfig] = useState(defaultConfig);
  const [activeSection, setActiveSection] = useState<NavSection>("transcribe");
  const [exportedPath, setExportedPath] = useState("");
  const [error, setError] = useState("");
  const [switchingModel, setSwitchingModel] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => makeIdleLevels());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const hotkeyStopTimerRef = useRef<number | null>(null);
  const hotkeyStopRequestedRef = useRef(false);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const optionsRef = useRef(options);
  const stateRef = useRef<RunState>(state);
  const hotkeyRecordingRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    return window.localflow.onWorkerProgress((payload: WorkerProgress) => {
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
        setStatus("Raw transcript ready; polishing locally");
      }
      if (payload.message) {
        setStatus(payload.message);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
    };
  }, []);

  useEffect(() => {
    return window.localflow.onDictationHotkey((payload) => {
      if (payload.event === "pressed") {
        if (hotkeyStopTimerRef.current !== null) {
          window.clearTimeout(hotkeyStopTimerRef.current);
          hotkeyStopTimerRef.current = null;
        }
        hotkeyStopRequestedRef.current = false;
        if (stateRef.current === "idle" || stateRef.current === "ready" || stateRef.current === "done" || stateRef.current === "error") {
          hotkeyRecordingRef.current = true;
          void startRecording(true);
        }
        return;
      }
      if (payload.event === "released" && hotkeyRecordingRef.current) {
        stopRecordingAfterBuffer();
      }
    });
  }, []);

  const cleanupRecordingResources = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (hotkeyStopTimerRef.current !== null) {
      window.clearTimeout(hotkeyStopTimerRef.current);
      hotkeyStopTimerRef.current = null;
    }
    hotkeyStopRequestedRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
  };

  const updateCleanupLevel = (level: CleanupLevel) => {
    setOptions((current) => ({
      ...current,
      cleanup: level !== "none",
      cleanupLevel: level,
      removeFillers: level !== "none",
      punctuation: level !== "none",
      logicalCorrection: level === "medium" || level === "high",
    }));
  };

  const transcribePath = async (path: string, name: string) => {
    setAudioPath(path);
    setAudioName(name);
    setState("processing");
    setError("");
    setResult(null);
    setExportedPath("");
    try {
      const data = await window.localflow.transcribeFile({ path, options: optionsRef.current });
      setResult(data);
      setRecordingSeconds(data.duration || recordingSeconds);
      setStatus("Transcript ready");
      setState("done");
      return data;
    } catch (transcriptionError) {
      const message = transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError);
      setError(message);
      setStatus("Transcription failed");
      setState("error");
      return null;
    }
  };

  const chooseFile = async () => {
    const selected = await window.localflow.selectAudioFile();
    if (!selected) {
      return;
    }
    const name = selected.split(/[\\/]/).pop() || selected;
    setLevels(makeIdleLevels());
    await transcribePath(selected, name);
  };

  const saveDroppedFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const extension = file.name.includes(".") ? `.${file.name.split(".").pop()}` : audioExtensionFromMime(file.type);
    const savedPath = await window.localflow.saveAudioBuffer({ buffer, extension });
    setLevels(makeIdleLevels());
    await transcribePath(savedPath, file.name);
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      await saveDroppedFile(file);
    }
  };

  const startLevelMeter = (stream: MediaStream) => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      const nextLevels = Array.from({ length: 128 }, (_, index) => {
        const sample = data[index] ?? 128;
        const centered = Math.abs(sample - 128) / 128;
        return Math.min(1, 0.08 + centered * 2.8);
      });
      setLevels(nextLevels);
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const startRecording = async (pasteWhenDone = false) => {
    try {
      setError("");
      setResult(null);
      setExportedPath("");
      setRecordingSeconds(0);
      setLevels(Array.from({ length: 128 }, () => 0.08));

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      startLevelMeter(stream);

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        cleanupRecordingResources();
        setState("saving");
        setStatus("Saving local recording");
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) {
          setState("error");
          setError("Recording did not contain audio data. Check the selected microphone and Windows permissions.");
          return;
        }
        const buffer = await blob.arrayBuffer();
        const extension = audioExtensionFromMime(blob.type);
        const savedPath = await window.localflow.saveAudioBuffer({ buffer, extension });
        const name = `Recording ${new Date().toLocaleTimeString()}`;
        const data = await transcribePath(savedPath, name);
        if (pasteWhenDone && data) {
          const text = data.polishedText || data.rawText;
          if (text) {
            await window.localflow.pasteText(text);
            setStatus("Pasted transcript");
          }
        }
        hotkeyRecordingRef.current = false;
      };

      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((Date.now() - startedAtRef.current) / 1000);
      }, 250);
      recorder.start(RECORDER_CHUNK_MS);
      setState("recording");
      setStatus("Recording");
      if (pasteWhenDone && hotkeyStopRequestedRef.current) {
        stopRecordingAfterBuffer();
      }
    } catch (recordingError) {
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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      setStatus("Stopping");
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
  };

  const stopRecordingAfterBuffer = () => {
    hotkeyStopRequestedRef.current = true;
    if (hotkeyStopTimerRef.current !== null) {
      return;
    }
    setStatus("Finishing phrase");
    const attemptStop = () => {
      hotkeyStopTimerRef.current = null;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        stopRecording();
        return;
      }
      if (hotkeyRecordingRef.current) {
        hotkeyStopTimerRef.current = window.setTimeout(attemptStop, 80);
      }
    };
    hotkeyStopTimerRef.current = window.setTimeout(attemptStop, HOTKEY_RELEASE_BUFFER_MS);
  };

  const runTranscription = async () => {
    if (!audioPath) {
      setStatus("Record or import audio first");
      return;
    }
    await transcribePath(audioPath, audioName);
  };

  const copyText = async (text?: string) => {
    if (text) {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    }
  };

  const exportText = async (text?: string, defaultName = "localflow-transcript.txt") => {
    if (!text) {
      return;
    }
    const saved = await window.localflow.exportText({ text, defaultName });
    if (saved) {
      setExportedPath(saved);
      setStatus("Exported");
    }
  };

  const reset = () => {
    cleanupRecordingResources();
    setState("idle");
    setAudioPath("");
    setAudioName("New transcription");
    setResult(null);
    setExportedPath("");
    setError("");
    setRecordingSeconds(0);
    setLevels(makeIdleLevels());
    setStatus("Ready");
  };

  const wordCount = (text?: string) => (text?.trim() ? text.trim().split(/\s+/).length : 0);
  const rawChars = result?.rawText.length || 0;
  const polishedChars = result?.polishedText.length || 0;
  const isBusy = state === "processing" || state === "saving" || switchingModel;
  const hasText = Boolean(result?.polishedText || result?.rawText);
  const isPolishing = state === "processing" && Boolean(result?.rawText) && !result?.polishedText;
  const activeNavItem = navItems.find((item) => item.id === activeSection) || navItems[0];
  const pageTitle = activeSection === "transcribe" ? audioName : activeNavItem.label;

  const switchWhisperModel = async (model: WhisperModelId) => {
    if (model === config.whisperModel || state === "recording" || switchingModel) {
      return;
    }
    setSwitchingModel(true);
    setError("");
    setStatus(`Loading Whisper ${model}`);
    try {
      const nextConfig = await window.localflow.setWhisperModel(model);
      setConfig((current) => ({ ...current, ...nextConfig }));
      setStatus(`Whisper ${model} ready`);
    } catch (modelError) {
      const message = modelError instanceof Error ? modelError.message : String(modelError);
      setError(message);
      setStatus("Model switch failed");
    } finally {
      setSwitchingModel(false);
    }
  };

  const stateLabel = useMemo(() => {
    if (state === "recording") return "Recording";
    if (state === "saving") return "Saving";
    if (state === "processing") return "Processing";
    if (state === "done") return "Ready";
    if (state === "error") return "Needs attention";
    return "Ready";
  }, [state]);

  const renderUtilityView = () => {
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
              <p>This build keeps the current local session visible. Persistent history will use a local database.</p>
            </div>
          </header>
          <div className="historyList">
            <article>
              <FileAudio size={20} />
              <div>
                <strong>{audioName}</strong>
                <small>{hasText ? `${wordCount(result?.rawText)} raw words · ${formatDuration(recordingSeconds)}` : "No transcript in this session yet"}</small>
              </div>
              <button onClick={() => setActiveSection("transcribe")}>Open</button>
            </article>
          </div>
        </section>
      );
    }

    if (activeSection === "models") {
      return (
        <section className="utilityPanel">
          <header>
            <Cpu size={24} />
            <div>
              <h2>Models</h2>
              <p>Local Whisper and Ollama configuration currently loaded by the desktop worker.</p>
            </div>
          </header>
          <div className="infoGrid">
            <div>
              <small>Whisper</small>
              <strong>{config.whisperModel}</strong>
            </div>
            <div>
              <small>Switch Whisper</small>
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
            </div>
            <div>
              <small>Language</small>
              <strong>{config.outputLanguage || config.language}</strong>
            </div>
            <div>
              <small>Cleanup model</small>
              <strong>{config.ollamaModel}</strong>
            </div>
            <div>
              <small>Ollama URL</small>
              <strong>{config.ollamaUrl}</strong>
            </div>
            <div>
              <small>GPU mode</small>
              <strong>CUDA · float16 · local only</strong>
            </div>
            <div>
              <small>Runtime</small>
              <strong>X:\wORK cODEX\localflow\runtime</strong>
            </div>
            <div>
              <small>Whisper cache</small>
              <strong>{config.whisperDownloadRoot || "X:\\stt-models"}</strong>
            </div>
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
              <p>Cleanup switches are live and will be used on the next transcription run.</p>
            </div>
          </header>
          <div className="settingsList">
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
          </div>
        </section>
      );
    }

    if (activeSection === "shortcuts") {
      return (
        <section className="utilityPanel">
          <header>
            <Keyboard size={24} />
            <div>
              <h2>Shortcuts</h2>
              <p>Hold the global shortcut to dictate into the currently focused field.</p>
            </div>
          </header>
          <div className="shortcutList">
            <div><kbd>Ctrl</kbd><kbd>Shift</kbd><span>Hold to record, release to paste polished text</span></div>
            <div><kbd>Ctrl</kbd><kbd>O</kbd><span>Import audio</span></div>
            <div><kbd>Ctrl</kbd><kbd>R</kbd><span>Reset current session</span></div>
          </div>
        </section>
      );
    }

    return (
      <section className="utilityPanel">
        <header>
          <Info size={24} />
          <div>
            <h2>About</h2>
            <p>LocalFlow is a Windows desktop transcription app using local Whisper and local Ollama cleanup.</p>
          </div>
        </header>
        <div className="infoGrid">
          <div>
            <small>Version</small>
            <strong>0.1.19</strong>
          </div>
          <div>
            <small>Privacy</small>
            <strong>Local processing only</strong>
          </div>
          <div>
            <small>Storage</small>
            <strong>X:\wORK cODEX\localflow</strong>
          </div>
        </div>
      </section>
    );
  };

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandGlyph">▌▌▌</span>
          <strong>LocalFlow</strong>
        </div>
        <nav className="navList">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeSection;
            return (
              <button
                className={`navItem ${active ? "active" : ""}`}
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={22} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="engineStatus">
          <span className="greenDot" />
          <div>
            <strong>Local engine</strong>
            <small>{stateLabel}</small>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="titleBar">
          <div>
            <div className="titleLine">
              <h1>{pageTitle}</h1>
              <Pencil size={18} />
            </div>
            <p>
              <span className="onlineDot" /> Whisper {config.whisperModel} · {config.outputLanguage || "Serbian Latin"} · Local only
            </p>
          </div>
          <button className="modelButton" onClick={() => setActiveSection("models")}>
            Choose model
            <ChevronDown size={17} />
          </button>
        </header>

        {activeSection === "transcribe" ? (
        <div className="contentGrid">
          <section className="mainColumn">
            <section className="recorderPanel">
              <div className="recorderToolbar">
                <span className={`timerPill ${state === "recording" ? "live" : ""}`}>
                  <span />
                  {formatDuration(recordingSeconds)}
                </span>
                <button className="speedButton">1x <ChevronDown size={16} /></button>
              </div>
              <Waveform levels={levels} state={state} />
              <div className="transport">
                <button className="smallControl">
                  <Mic size={19} />
                  <ChevronDown size={14} />
                </button>
                {state === "recording" ? (
                  <button className="recordButton stop" onClick={stopRecording} title="Stop and transcribe">
                    <Square size={25} fill="currentColor" />
                  </button>
                ) : (
                  <button className="recordButton" onClick={() => startRecording()} disabled={isBusy} title="Record">
                    <Mic size={26} />
                  </button>
                )}
                <button className="smallControl" onClick={runTranscription} disabled={!audioPath || isBusy || state === "recording"}>
                  <Square size={15} fill="currentColor" />
                </button>
                <span className="durationReadout">{formatDuration(recordingSeconds)}</span>
                <button className="resetButton" onClick={reset} disabled={isBusy}>Reset</button>
              </div>
            </section>

            <section
              className="importPanel"
              onDrop={onDrop}
              onDragOver={(event) => event.preventDefault()}
              aria-label="Audio import area"
            >
              <Upload size={42} />
              <div>
                <h2>Drag & drop audio files here</h2>
                <p>or</p>
                <button onClick={chooseFile} disabled={isBusy || state === "recording"}>Import audio</button>
              </div>
              <footer>
                <span>Supports: .wav, .mp3, .m4a, .flac, .ogg, .opus, .webm</span>
                <span>Runtime: X:\wORK cODEX\localflow\runtime</span>
              </footer>
            </section>

            {error ? <div className="errorBox">{error}</div> : null}

            <section className="transcriptGrid">
              <article className="textPane">
                <div className="paneHeader">
                  <h2>Raw transcript</h2>
                  <div className="paneActions">
                    <button onClick={() => copyText(result?.rawText)} disabled={!result?.rawText}><Clipboard size={17} /> Copy</button>
                    <button onClick={() => exportText(result?.rawText, "localflow-raw-transcript.txt")} disabled={!result?.rawText}>
                      <FileDown size={17} /> Export
                    </button>
                  </div>
                </div>
                <textarea readOnly value={result?.rawText || ""} placeholder="Raw Whisper output appears here after recording stops or audio is imported." />
                <footer>
                  <span>Words: {wordCount(result?.rawText)}</span>
                  <span>Characters: {rawChars}</span>
                  <span>{formatDuration(recordingSeconds)}</span>
                </footer>
              </article>

              <article className="textPane">
                <div className="paneHeader">
                  <h2>Polished text</h2>
                  <div className="paneActions">
                    <button onClick={() => copyText(result?.polishedText)} disabled={!result?.polishedText}><Clipboard size={17} /> Copy</button>
                    <button onClick={() => exportText(result?.polishedText, "localflow-polished-transcript.txt")} disabled={!result?.polishedText}>
                      <FileDown size={17} /> Export
                    </button>
                  </div>
                </div>
                <textarea
                  readOnly
                  value={result?.polishedText || ""}
                  placeholder={isPolishing ? "Polishing locally with Qwen..." : "Local Ollama cleanup appears here after Whisper finishes."}
                />
                <footer>
                  <span>Words: {wordCount(result?.polishedText)}</span>
                  <span>Characters: {polishedChars}</span>
                  <span>{formatDuration(recordingSeconds)}</span>
                </footer>
              </article>
            </section>
          </section>

          <aside className="inspector">
            <div className="inspectorHeader">
              <h2>Cleanup & formatting</h2>
              <ChevronDown size={16} />
            </div>
            <div className="cleanupLevelGrid">
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

            <div className="processingHeader">
              <h2>Processing options</h2>
              <ChevronDown size={16} />
            </div>
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
            <label className="selectRow">
              <span>Language <Info size={14} /></span>
              <button>Serbian Latin <ChevronDown size={16} /></button>
            </label>

            <div className="localNotice">
              <CheckCircle2 size={20} />
              <span>
                <strong>All processing happens locally.</strong>
                <small>Your data never leaves this device.</small>
              </span>
            </div>
          </aside>
        </div>
        ) : (
          <div className="contentGrid secondaryGrid">
            <section className="mainColumn">
              {renderUtilityView()}
            </section>
            <aside className="inspector">
              <div className="inspectorHeader">
                <h2>Current session</h2>
                <ChevronDown size={16} />
              </div>
              <div className="sideSummary">
                <div>
                  <small>Status</small>
                  <strong>{status}</strong>
                </div>
                <div>
                  <small>Audio</small>
                  <strong>{audioPath ? audioName : "None"}</strong>
                </div>
                <div>
                  <small>Raw words</small>
                  <strong>{wordCount(result?.rawText)}</strong>
                </div>
                <div>
                  <small>Polished characters</small>
                  <strong>{polishedChars}</strong>
                </div>
              </div>
              <div className="localNotice">
                <CheckCircle2 size={20} />
                <span>
                  <strong>All processing happens locally.</strong>
                  <small>Your data never leaves this device.</small>
                </span>
              </div>
            </aside>
          </div>
        )}

        <footer className="bottomBar">
          <span><CheckCircle2 size={18} /> {state === "done" && hasText ? "Transcript ready" : status}</span>
          <span>GPU: local hardware</span>
          <span>Cache: X:\wORK cODEX\localflow\runtime</span>
          <span>Version 0.1.19</span>
          <span className="greenDot" />
        </footer>
      </section>
    </main>
  );
}
