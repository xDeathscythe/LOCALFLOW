export type CleanupLevel = "none" | "light" | "medium" | "high";

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
  type: string;
  stage?: string;
  message?: string;
  data?: Partial<TranscriptResult>;
  config?: {
    whisperModel: string;
    whisperDownloadRoot?: string;
    language: string;
    outputLanguage?: string;
    ollamaModel: string;
    ollamaUrl: string;
  };
};

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }

  interface Window {
    localflow: {
      selectAudioFile: () => Promise<string | null>;
      saveAudioBuffer: (payload: { buffer: ArrayBuffer; extension?: string }) => Promise<string>;
      transcribeFile: (payload: { path: string; options: PolishOptions }) => Promise<TranscriptResult>;
      setWhisperModel: (model: "large-v3-turbo" | "large-v3") => Promise<{ whisperModel: string; whisperDownloadRoot?: string }>;
      exportText: (payload: { text: string; defaultName?: string }) => Promise<string | null>;
      openPath: (filePath: string) => Promise<string>;
      pasteText: (text: string) => Promise<boolean>;
      onDictationHotkey: (callback: (payload: { type: "hotkey"; event: "pressed" | "released" }) => void) => () => void;
      onWorkerProgress: (callback: (payload: WorkerProgress) => void) => () => void;
    };
  }
}
