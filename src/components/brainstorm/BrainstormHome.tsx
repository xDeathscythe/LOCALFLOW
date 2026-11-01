import type { ReactNode } from 'react';
import { MessageCircle, Footprints, PlugZap } from 'lucide-react';
import type { BrainstormMode, BrainstormState } from '../../lib/brainstorm';
import { ModuleArt } from './ModuleArt';
import { MODULES } from './modules';
import { PastPages } from './PastPages';

interface HomeProps {
  state: BrainstormState; composer: ReactNode;
  choose: (mode: BrainstormMode) => void; open: (mode: BrainstormMode, index: number) => Promise<void>;
  openSession: (id: string) => void; prepare: (mode: BrainstormMode) => void; connect: () => void;
}

function readiness(state: BrainstormState, mode: BrainstormMode): string {
  const p = state.prepared;
  if (mode === 'paths' && p.paths) return `${p.paths.data.seeds.length} ideas ready to branch`;
  if (mode === 'story' && p.story) return `${p.story.data.chapters.length} chapters and ${p.story.data.continuations.length} ways forward`;
  if (mode === 'challenges' && p.challenges) return `${p.challenges.data.suggestions.length} next steps that fit today`;
  if (mode === 'board' && p.board) return `${p.board.data.pins.length} pieces that connect`;
  if (mode === 'thoughts' && p.thoughts) return `${p.thoughts.data.thoughts.length} thoughts to sit with`;
  if (state.preparing.includes(mode)) return 'Niwa is preparing this…';
  return state.failures[mode] ? 'Not ready yet' : 'Prepares in the background';
}

export function BrainstormHome({ state, composer, choose, open, openSession, prepare, connect }: HomeProps) {
  const present = state.prepared.present, preparingPresent = state.preparing.includes('present');
  const due = state.sessions.filter(s => s.mode === 'challenges' && s.reminder && s.nextCheckIn <= Date.now());
  return <div className="brainHome">
    <section className="hero" aria-labelledby="hero-title">
      <ModuleArt mode="present" live={!present && preparingPresent} className="heroArt" />
      {present ? <div className="heroText">
        <p className="heroKicker">Niwa kept a thought for you</p>
        <h1 id="hero-title" className="voiceTitle" dir="auto">{present.data.idea.title}</h1>
        <p className="voice heroBody" dir="auto">{present.data.idea.body}</p>
        <div className="sceneActions">
          <button className="primaryButton" onClick={() => void open('present', 0).catch(() => {})}><MessageCircle size={15} />Talk it through</button>
          <button className="quietButton" onClick={() => choose('present')}>See where it came from</button>
        </div>
      </div> : <div className="heroText">
        <h1 id="hero-title" className="voiceTitle">Where could this lead?</h1>
        {preparingPresent ? <p className="voice">Niwa is reading your recent notes and conversations. Each idea appears here as soon as it is ready.</p>
          : state.failures.present ? <><p className="voice">Niwa could not prepare ideas yet. {state.failures.present}</p><div className="sceneActions"><button className="primaryButton" onClick={() => prepare('present')}>Try again</button><button className="quietButton" onClick={connect}><PlugZap size={14} />Connect Codex</button></div></>
          : <><p className="voice">Niwa prepares ideas from your notes and conversations in the background, so each space is ready when you open it.</p><button className="primaryButton" onClick={() => prepare('present')}>Prepare ideas now</button></>}
      </div>}
    </section>
    {due.map(session => <button key={session.id} className="checkIn" onClick={() => openSession(session.id)}><Footprints size={15} /><span dir="auto">How did “{session.title}” go today?</span></button>)}
    <nav className="doors" aria-label="Brainstorm spaces">{MODULES.filter(item => item.id !== 'present').map(item => <button key={item.id} className="door" data-ready={Boolean(state.prepared[item.id])} onClick={() => choose(item.id)}>
      <ModuleArt mode={item.id} live={state.preparing.includes(item.id)} />
      <strong>{item.title}</strong><span>{readiness(state, item.id)}</span>
    </button>)}</nav>
    <div className="homeComposer">{composer}</div>
    <PastPages sessions={state.sessions} open={openSession} />
  </div>;
}
