import { Check, FilePlus2, Folder, FolderPlus, Mic, Save, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TreeView, type TreeNode } from "@/components/ui/tree-view";
import {
  NOTES_STORAGE_KEY,
  findFirstNoteId,
  findNotesItem,
  findParentFolderId,
  folderIds,
  insertNotesItem,
  loadNotes,
  removeNotesItem,
  updateNotesItem,
  type NoteItem,
  type NotesItem,
} from "@/lib/notes";

type VoiceCapture = { id: number; text: string };

type NotesPageProps = {
  capture: VoiceCapture | null;
  onCaptureHandled: () => void;
  onStatus: (message: string) => void;
  recording: boolean;
  recordDisabled: boolean;
  onToggleRecording: () => void;
};

function toTreeNodes(items: NotesItem[]): TreeNode[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.kind === "folder" && item.children.length === 0 ? <Folder size={16} /> : undefined,
    children: item.kind === "folder" ? toTreeNodes(item.children) : undefined,
    data: item,
  }));
}

function persistNotes(items: NotesItem[]) {
  window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(items));
}

export function NotesPage({
  capture,
  onCaptureHandled,
  onStatus,
  recording,
  recordDisabled,
  onToggleRecording,
}: NotesPageProps) {
  const [items, setItems] = useState<NotesItem[]>(() => loadNotes(window.localStorage));
  const [selectedId, setSelectedId] = useState(() => {
    const loaded = loadNotes(window.localStorage);
    return findFirstNoteId(loaded) || loaded[0]?.id || "";
  });
  const initialSelected = findNotesItem(items, selectedId);
  const [draft, setDraft] = useState(initialSelected?.kind === "note" ? initialSelected.content : "");
  const [title, setTitle] = useState(initialSelected?.kind === "note" ? initialSelected.label : "");
  const [saved, setSaved] = useState(true);
  const [creatingKind, setCreatingKind] = useState<"note" | "folder" | null>(null);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [treeVersion, setTreeVersion] = useState(0);
  const handledCaptureId = useRef<number | null>(null);
  const selectedItem = findNotesItem(items, selectedId);
  const treeData = useMemo(() => toTreeNodes(items), [items]);

  const applyCurrentDraft = (source: NotesItem[]) => {
    if (selectedItem?.kind !== "note") return;
    return updateNotesItem(source, selectedItem.id, (item) => item.kind === "note"
      ? { ...item, label: title.trim() || item.label, content: draft, updatedAt: new Date().toISOString() }
      : item);
  };

  const saveCurrentNote = () => {
    const next = applyCurrentDraft(items);
    if (!next) return;
    setItems(next);
    persistNotes(next);
    const savedNote = findNotesItem(next, selectedId);
    if (savedNote?.kind === "note") setTitle(savedNote.label);
    setSaved(true);
    onStatus("Note saved locally");
  };

  const selectItem = (id: string) => {
    const currentItems = !saved ? applyCurrentDraft(items) || items : items;
    if (!saved) {
      setItems(currentItems);
      persistNotes(currentItems);
    }
    const nextSelected = findNotesItem(currentItems, id);
    setSelectedId(id);
    setDraft(nextSelected?.kind === "note" ? nextSelected.content : "");
    setTitle(nextSelected?.kind === "note" ? nextSelected.label : "");
    setSaved(true);
  };

  const beginCreate = (kind: "note" | "folder") => {
    setCreatingKind(kind);
    setNewItemLabel("");
  };

  const createItem = (kind: "note" | "folder", requestedLabel: string) => {
    const label = requestedLabel.trim();
    if (!label) return;
    const currentItems = !saved ? applyCurrentDraft(items) || items : items;

    const parentId = selectedItem?.kind === "folder"
      ? selectedItem.id
      : findParentFolderId(currentItems, selectedId);
    const id = crypto.randomUUID();
    const newItem: NotesItem = kind === "folder"
      ? { id, kind, label, children: [] }
      : { id, kind, label, content: "", updatedAt: new Date().toISOString() };
    const next = insertNotesItem(currentItems, parentId, newItem);
    setItems(next);
    persistNotes(next);
    setSelectedId(id);
    setDraft("");
    setTitle(kind === "note" ? label : "");
    setSaved(true);
    setCreatingKind(null);
    setNewItemLabel("");
    setTreeVersion((current) => current + 1);
    onStatus(`${kind === "folder" ? "Folder" : "Note"} created`);
  };

  const deleteSelected = () => {
    if (!selectedItem) return;
    const hasChildren = selectedItem.kind === "folder" && selectedItem.children.length > 0;
    const message = hasChildren
      ? `Delete “${selectedItem.label}” and everything inside it?`
      : `Delete “${selectedItem.label}”?`;
    if (!window.confirm(message)) return;

    const next = removeNotesItem(items, selectedItem.id);
    const nextId = findFirstNoteId(next) || next[0]?.id || "";
    const nextSelected = findNotesItem(next, nextId);
    setItems(next);
    persistNotes(next);
    setSelectedId(nextId);
    setDraft(nextSelected?.kind === "note" ? nextSelected.content : "");
    setTitle(nextSelected?.kind === "note" ? nextSelected.label : "");
    setSaved(true);
    setTreeVersion((current) => current + 1);
    onStatus(`${selectedItem.kind === "folder" ? "Folder" : "Note"} deleted`);
  };

  useEffect(() => {
    if (!capture || handledCaptureId.current === capture.id) return;
    handledCaptureId.current = capture.id;

    let note = findNotesItem(items, selectedId);
    let nextItems = items;
    let noteId = selectedId;
    if (note?.kind !== "note") {
      noteId = crypto.randomUUID();
      const newNote: NoteItem = {
        id: noteId,
        kind: "note",
        label: `Voice note ${new Date().toLocaleString()}`,
        content: "",
        updatedAt: new Date().toISOString(),
      };
      const parentId = note?.kind === "folder" ? note.id : undefined;
      nextItems = insertNotesItem(nextItems, parentId, newNote);
      note = newNote;
    }

    const base = noteId === selectedId ? draft : note.content;
    const content = [base.trim(), capture.text.trim()].filter(Boolean).join("\n\n");
    const noteTitle = noteId === selectedId ? title.trim() || note.label : note.label;
    nextItems = updateNotesItem(nextItems, noteId, (item) => item.kind === "note"
      ? { ...item, label: noteTitle, content, updatedAt: new Date().toISOString() }
      : item);
    setItems(nextItems);
    persistNotes(nextItems);
    setSelectedId(noteId);
    setDraft(content);
    setTitle(noteTitle);
    setSaved(true);
    setTreeVersion((current) => current + 1);
    onStatus("Voice transcript saved to note");
    onCaptureHandled();
  }, [capture, draft, items, onCaptureHandled, onStatus, selectedId, title]);

  return (
    <section className="notesPage">
      <aside className="notesTreePane">
        <div className="notesTreeToolbar">
          <div>
            <strong>All notes</strong>
            <span>Select a folder before creating an item inside it.</span>
          </div>
          <div>
            <button onClick={() => beginCreate("note")} title="New note" aria-label="New note">
              <FilePlus2 size={17} />
            </button>
            <button onClick={() => beginCreate("folder")} title="New folder" aria-label="New folder">
              <FolderPlus size={17} />
            </button>
            <button
              className="danger"
              onClick={deleteSelected}
              disabled={!selectedItem}
              title="Delete selected"
              aria-label="Delete selected note or folder"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {creatingKind ? (
          <form
            className="notesCreateRow"
            onSubmit={(event) => {
              event.preventDefault();
              createItem(creatingKind, newItemLabel);
            }}
          >
            <input
              autoFocus
              value={newItemLabel}
              onChange={(event) => setNewItemLabel(event.target.value)}
              placeholder={creatingKind === "folder" ? "Folder name" : "Note title"}
              aria-label={creatingKind === "folder" ? "Folder name" : "Note title"}
            />
            <button type="submit" disabled={!newItemLabel.trim()} aria-label={`Create ${creatingKind}`}>
              <Check size={16} />
            </button>
            <button type="button" onClick={() => setCreatingKind(null)} aria-label="Cancel">
              <X size={16} />
            </button>
          </form>
        ) : null}
        <TreeView
          key={treeVersion}
          className="notesTreeView"
          data={treeData}
          defaultExpandedIds={folderIds(items)}
          selectedIds={selectedId ? [selectedId] : []}
          onSelectionChange={(ids) => ids[0] && selectItem(ids[0])}
        />
      </aside>

      <section className="noteWorkspace">
        {selectedItem?.kind === "note" ? (
          <>
            <header className="noteEditorHeader">
              <div>
                <input
                  className="noteTitleInput"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setSaved(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    saveCurrentNote();
                  }}
                  aria-label="Note title"
                />
                <span>{saved ? "Saved locally" : "Unsaved changes"}</span>
              </div>
              <div className="noteEditorActions">
                <button onClick={saveCurrentNote} disabled={saved}>
                  <Save size={16} /> Save
                </button>
                <button
                  className={recording ? "recording" : "primary"}
                  onClick={onToggleRecording}
                  disabled={recordDisabled}
                >
                  {recording ? <Square size={15} fill="currentColor" /> : <Mic size={16} />}
                  {recording ? "Stop" : "Transcribe"}
                </button>
              </div>
            </header>
            <textarea
              className="noteDocument"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaved(false);
              }}
              placeholder="Write or transcribe into this note…"
              aria-label={selectedItem.label}
            />
          </>
        ) : (
          <div className="noteFolderState">
            <Folder size={32} />
            <strong>{selectedItem?.label || "Choose a folder or note"}</strong>
            <span>Create a note or subfolder here with the controls on the left.</span>
          </div>
        )}
      </section>
    </section>
  );
}
