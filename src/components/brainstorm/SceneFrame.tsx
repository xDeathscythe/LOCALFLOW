import type { ReactNode } from 'react';
import { RefreshCw, PlugZap } from 'lucide-react';
import type { BrainstormMode, BrainstormState, Prepared } from '../../lib/brainstorm';
import { ModuleArt } from './ModuleArt';
import { moduleInfo } from './modules';

interface SceneFrameProps<M extends BrainstormMode> {
  mode: M; state: BrainstormState; prepare: () => void; connect: () => void;
  children: (prepared: Prepared<M>) => ReactNode; aside?: ReactNode;
}

const when = (time: number): string => new Date(time).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// Every module scene shares the same arrival: its drawing, its purpose, then prepared content or a clear next step.
export function SceneFrame<M extends BrainstormMode>({ mode, state, prepare, connect, children, aside }: SceneFrameProps<M>) {
  const info = moduleInfo(mode), prepared = state.prepared[mode] as Prepared<M> | undefined;
  const preparing = state.preparing.includes(mode), failure = state.failures[mode];
  return <div className={`scene scene-${mode}`}>
    <header className="sceneHeader">
      <ModuleArt mode={mode} live={preparing} className="sceneArt" />
      <div><h1>{info.title}</h1><p>{info.lede}</p></div>
      {prepared && <button className="quietButton" disabled={preparing} onClick={prepare} title={`Prepared ${when(prepared.generatedAt)}`}><RefreshCw size={13} className={preparing ? 'spin' : ''} />{preparing ? 'Preparing new ideas' : 'Prepare new ideas'}</button>}
    </header>
    {prepared ? children(prepared) : <div className="sceneWaiting" aria-live="polite">
      {preparing ? <p>Niwa is reading your recent notes and conversations to prepare this. You can keep using the rest of the space.</p>
        : failure ? <><p>Niwa could not prepare this yet. {failure}</p><div><button className="primaryButton" onClick={prepare}><RefreshCw size={14} />Try again</button><button className="quietButton" onClick={connect}><PlugZap size={14} />Connect Codex</button></div></>
        : <><p>Niwa prepares this in the background from your notes and conversations.</p><button className="primaryButton" onClick={prepare}>Prepare it now</button></>}
    </div>}
    {aside}
  </div>;
}
