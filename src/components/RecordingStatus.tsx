import { useEffect, useRef, useState } from 'react';
import type { RecordingOverlayState } from '../types';

function useElapsedSeconds(startedAt: number, seconds: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => tick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : seconds;
}

export function RecordingClock({ startedAt, seconds }: { startedAt: number; seconds: number }) {
  const elapsed = useElapsedSeconds(startedAt, seconds);
  return <time>{Math.floor(elapsed / 60).toString().padStart(2, '0')}:{Math.floor(elapsed % 60).toString().padStart(2, '0')}</time>;
}

// The clock updates this small component, never the Notes/chat parent tree.
export function RecordingOverlay({ startedAt, seconds, section, ...state }: Omit<RecordingOverlayState, 'elapsedSeconds' | 'selected'> & { startedAt: number; seconds: number; section: string }) {
  const elapsedSeconds = useElapsedSeconds(startedAt, seconds);
  const previousSection = useRef<string | null>(null);
  const { recording, starting, agentListening, recordingTarget } = state;
  useEffect(() => {
    const changed = previousSection.current !== section;
    previousSection.current = section;
    const selected = section === 'niwa' ? 'agent' : section === 'meetings' ? 'transcribe' : section === 'transcribe' ? 'microphone' : undefined;
    window.localflow.setRecordingOverlayState({ recording, starting, agentListening, recordingTarget, elapsedSeconds, selected: changed ? selected : undefined });
  }, [recording, starting, agentListening, recordingTarget, elapsedSeconds, section]);
  return null;
}
