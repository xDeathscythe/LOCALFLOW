export type BrainstormMode = 'present' | 'paths' | 'story' | 'challenges' | 'board' | 'thoughts';
export type Idea = { title: string; body: string; sources: string[] };
export type PathNode = { id: string; parentId: string; title: string; body: string; suggested?: boolean };
export type BoardPin = { id: string; kind: 'text' | 'note' | 'image' | 'link' | 'message'; title: string; body: string; url?: string; x: number; y: number };
export type BoardEdge = { id: string; from: string; to: string; label: string };
export type BrainstormSession = {
  id: string; mode: BrainstormMode; title: string; seed: string;
  messages: { id: string; role: string; content: string; timestamp: number }[];
  nodes: PathNode[]; selectedId: string; pins: BoardPin[]; edges: BoardEdge[];
  updatedAt: number; reminder: boolean; nextCheckIn: number; noteId?: string;
};
export type BrainstormState = {
  revision: number; home: { present: Idea; ideas: Idea[]; thoughts: Idea[]; generatedAt: number } | null;
  sessions: BrainstormSession[];
  feedback: { id: string; title: string; body: string; rating: number; at: number }[];
};
export type BrainstormAction = (action: string, value?: Record<string, unknown>) => Promise<BrainstormState>;
