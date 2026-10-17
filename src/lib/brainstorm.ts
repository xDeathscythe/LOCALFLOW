export type BrainstormMode = 'present' | 'paths' | 'story' | 'challenges' | 'board' | 'thoughts';
export type Idea = { title: string; body: string; sources: string[] };
export type PathNode = { id: string; parentId: string; title: string; body: string; suggested?: boolean };
export type BoardPin = { id: string; kind: 'text' | 'note' | 'image' | 'link' | 'message'; title: string; body: string; url?: string; x: number; y: number };
export type BoardEdge = { id: string; from: string; to: string; label: string };
export type BrainstormSession = {
  id: string; mode: BrainstormMode; title: string; seed: string;
  messages: { id: string; role: string; content: string; timestamp: number }[];
  nodes: PathNode[]; selectedId: string; pins: BoardPin[]; edges: BoardEdge[];
  updatedAt: number; reminder: boolean; nextCheckIn: number; noteId?: string; origin?: string; savedAt?: number;
};
export type SourceLabel = { kind: 'note' | 'chat' | 'brainstorm' | 'memory' | 'feedback'; label: string; at?: number };
export type PreparedData = {
  present: { idea: Idea; origin: string; whyNow: string; opening: string };
  paths: { seeds: (Idea & { branches: { title: string; body: string }[] })[] };
  story: { chapters: (Idea & { when: string })[]; patterns: { title: string; body: string }[]; continuations: { title: string; body: string; question: string }[] };
  challenges: { wins: Idea[]; struggles: Idea[]; suggestions: { title: string; why: string; firstStep: string; opening: string }[] };
  board: { title: string; question: string; pins: Idea[]; links: { from: number; to: number; label: string }[] };
  thoughts: { thoughts: (Idea & { opening: string })[] };
};
export type Prepared<M extends BrainstormMode = BrainstormMode> = { generatedAt: number; data: PreparedData[M]; sources: Record<string, SourceLabel> };
export type BrainstormState = {
  revision: number; epoch: string; seq: number;
  prepared: { [M in BrainstormMode]?: Prepared<M> };
  sessions: BrainstormSession[];
  feedback: { id: string; title: string; body: string; rating: number; at: number }[];
  preparing: BrainstormMode[]; answering: string[]; growing: string[]; failures: Partial<Record<BrainstormMode, string>>;
  openedId?: string;
};
export type BrainstormAction = (action: string, value?: Record<string, unknown>) => Promise<BrainstormState>;
