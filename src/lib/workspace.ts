export type ProjectFolder = { id: string; label: string; cwd: string; archived?: boolean };
export type ProjectChat = { id: string; folderId: string; label: string; updatedAt: number; archived?: boolean };
export type Projects = { folders: ProjectFolder[]; chats: ProjectChat[]; activeId: string };
export type AgentActivity = { id: string; type: string; title: string; content: string; status: string };
export type PagePresentation = { wide?: boolean; cover?: string; icon?: string; iconText?: string; coverPosition?: number };
export type NoteNode = { id: string; kind: 'folder' | 'note' | 'database'; label: string; children?: NoteNode[]; updatedAt?: string; sourceUrl?: string; icon?: string; presentation?: PagePresentation };
export type MarkdownNote = NoteNode & { content: string; revision: string; path: string; document?: import('@tiptap/core').JSONContent; html?: string };
export type NotesIndex = { items: NoteNode[]; directory: string };
