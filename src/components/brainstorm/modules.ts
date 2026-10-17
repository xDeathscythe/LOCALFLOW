import type { BrainstormAction, BrainstormMode, BrainstormState } from '../../lib/brainstorm';

export interface ModuleInfo { id: BrainstormMode; title: string; lede: string }

export const MODULES: ModuleInfo[] = [
  { id: 'present', title: 'Present', lede: 'A thought Niwa kept for you, and where it came from.' },
  { id: 'paths', title: 'Paths', lede: 'Pick an idea and follow the directions it could take.' },
  { id: 'story', title: 'Story', lede: 'The chapters so far, the patterns between them, and what could come next.' },
  { id: 'challenges', title: 'Challenges', lede: 'What you have already climbed, and a next step that fits today.' },
  { id: 'board', title: 'Idea board', lede: 'Pieces from your notes and chats, connected so you can see the whole.' },
  { id: 'thoughts', title: 'Free thoughts', lede: 'Three thoughts to sit with. Tell Niwa which ones land.' },
];

export const moduleInfo = (mode: BrainstormMode): ModuleInfo => MODULES.find(item => item.id === mode)!;

export interface SceneProps {
  state: BrainstormState;
  run: BrainstormAction;
  open: (index: number) => Promise<void>;
  openSession: (id: string) => void;
  prepare: () => void;
  connect: () => void;
}
