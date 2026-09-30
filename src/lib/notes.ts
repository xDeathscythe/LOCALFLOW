export const NOTES_STORAGE_KEY = "localflow.notes.tree.v1";
export const LEGACY_NOTES_STORAGE_KEY = "localflow.notes";
const PAGE_SESSION_KEY = 'localflow.notes.pages.v1';
type PageSession = { tabs: string[]; active: string; appearances: Record<string, { font?: 'default' | 'serif' | 'mono'; small?: boolean; wide?: boolean }> };
export function loadPageSession(storage: Pick<Storage, 'getItem'>): PageSession {
  try {
    const value = JSON.parse(storage.getItem(PAGE_SESSION_KEY) || '{}');
    return { tabs: Array.isArray(value.tabs) ? [...new Set<string>(value.tabs.filter((id: unknown) => typeof id === 'string'))] : [], active: typeof value.active === 'string' ? value.active : '', appearances: value.appearances && typeof value.appearances === 'object' && !Array.isArray(value.appearances) ? value.appearances : {} };
  } catch { return { tabs: [], active: '', appearances: {} }; }
}
export function savePageSession(storage: Pick<Storage, 'setItem'>, value: PageSession) {
  try { storage.setItem(PAGE_SESSION_KEY, JSON.stringify(value)); } catch { /* Page content is saved separately on disk; a full local UI cache must not block editing. */ }
}

export type NoteItem = {
  id: string;
  kind: "note";
  label: string;
  content: string;
  updatedAt: string;
};

export type FolderItem = {
  id: string;
  kind: "folder";
  label: string;
  children: NotesItem[];
};

export type NotesItem = NoteItem | FolderItem;

function isNotesItem(value: unknown): value is NotesItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NotesItem>;
  if (typeof item.id !== "string" || typeof item.label !== "string") return false;
  if (item.kind === "note") {
    return typeof item.content === "string" && typeof item.updatedAt === "string";
  }
  return item.kind === "folder" && Array.isArray(item.children) && item.children.every(isNotesItem);
}

export function createInitialNotes(legacyText = ""): NotesItem[] {
  const children: NotesItem[] = legacyText.trim()
    ? [{
        id: "legacy-note",
        kind: "note",
        label: "Imported note",
        content: legacyText,
        updatedAt: new Date().toISOString(),
      }]
    : [];
  return [{ id: "inbox", kind: "folder", label: "Inbox", children }];
}

export function loadNotes(storage: Pick<Storage, "getItem">): NotesItem[] {
  const saved = storage.getItem(NOTES_STORAGE_KEY);
  if (saved) {
    try {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every(isNotesItem)) return parsed;
    } catch {
      // Invalid local data falls back to the last legacy note instead of breaking the page.
    }
  }
  return createInitialNotes(storage.getItem(LEGACY_NOTES_STORAGE_KEY) || "");
}
