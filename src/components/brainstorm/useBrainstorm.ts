import { useCallback, useEffect, useState } from 'react';
import type { BrainstormAction, BrainstormState } from '../../lib/brainstorm';

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function useBrainstorm(visible: boolean): { state: BrainstormState | null; run: BrainstormAction; error: string; clearError: () => void } {
  const [state, setState] = useState<BrainstormState | null>(null);
  const [error, setError] = useState('');
  // Events and call results can arrive out of order; seq orders snapshots within one host process.
  const accept = useCallback((next: BrainstormState) => setState(current => !current || next.epoch !== current.epoch || next.seq >= current.seq ? next : current), []);
  useEffect(() => window.localflow.onBrainstormState(value => accept(value as BrainstormState)), [accept]);
  const run = useCallback<BrainstormAction>(async (action, value) => {
    try { setError(''); const next = await window.localflow.brainstormCall(action, value); accept(next); return next; }
    catch (failure) { setError(message(failure)); throw failure; }
  }, [accept]);
  useEffect(() => { if (visible) void run('load').catch(() => {}); }, [visible, run]);
  return { state, run, error, clearError: () => setError('') };
}
