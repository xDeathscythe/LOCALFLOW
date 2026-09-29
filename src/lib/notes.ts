export const NOTES_STORAGE_KEY = "localflow.notes.tree.v1";
export const LEGACY_NOTES_STORAGE_KEY = "localflow.notes";

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

export function findNotesItem(items: NotesItem[], id: string): NotesItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.kind === "folder") {
      const nested = findNotesItem(item.children, id);
      if (nested) return nested;
    }
  }
}

export function findFirstNoteId(items: NotesItem[]): string | undefined {
  for (const item of items) {
    if (item.kind === "note") return item.id;
    const nested = findFirstNoteId(item.children);
    if (nested) return nested;
  }
}

export function findParentFolderId(
  items: NotesItem[],
  id: string,
  parentId?: string,
): string | undefined {
  for (const item of items) {
    if (item.id === id) return parentId;
    if (item.kind === "folder") {
      const nested = findParentFolderId(item.children, id, item.id);
      if (nested !== undefined) return nested;
    }
  }
}

export function folderIds(items: NotesItem[]): string[] {
  return items.flatMap((item) => item.kind === "folder"
    ? [item.id, ...folderIds(item.children)]
    : []);
}

export function insertNotesItem(
  items: NotesItem[],
  parentId: string | undefined,
  newItem: NotesItem,
): NotesItem[] {
  if (!parentId) return [...items, newItem];
  return items.map((item) => item.kind === "folder"
    ? {
        ...item,
        children: item.id === parentId
          ? [...item.children, newItem]
          : insertNotesItem(item.children, parentId, newItem),
      }
    : item);
}

export function updateNotesItem(
  items: NotesItem[],
  id: string,
  update: (item: NotesItem) => NotesItem,
): NotesItem[] {
  return items.map((item) => {
    if (item.id === id) return update(item);
    return item.kind === "folder"
      ? { ...item, children: updateNotesItem(item.children, id, update) }
      : item;
  });
}

export function removeNotesItem(items: NotesItem[], id: string): NotesItem[] {
  return items
    .filter((item) => item.id !== id)
    .map((item) => item.kind === "folder"
      ? { ...item, children: removeNotesItem(item.children, id) }
      : item);
}
