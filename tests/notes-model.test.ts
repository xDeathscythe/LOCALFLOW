import assert from "node:assert/strict";
import {
  NOTES_STORAGE_KEY,
  createInitialNotes,
  findNotesItem,
  findParentFolderId,
  insertNotesItem,
  loadNotes,
  removeNotesItem,
  updateNotesItem,
  type NotesItem,
} from "../src/lib/notes.ts";

const initial = createInitialNotes("");
const project: NotesItem = { id: "project", kind: "folder", label: "Project", children: [] };
const note: NotesItem = {
  id: "note",
  kind: "note",
  label: "Meeting",
  content: "Draft",
  updatedAt: "2026-08-07T00:00:00.000Z",
};
const nested = insertNotesItem(insertNotesItem(initial, "inbox", project), "project", note);
assert.equal(findParentFolderId(nested, "note"), "project");
assert.equal(findNotesItem(nested, "note")?.label, "Meeting");

const updated = updateNotesItem(nested, "note", (item) => item.kind === "note"
  ? { ...item, label: "Renamed meeting", content: "Saved transcript" }
  : item);
assert.equal(findNotesItem(updated, "note")?.kind === "note" && findNotesItem(updated, "note")?.content, "Saved transcript");
assert.equal(findNotesItem(updated, "note")?.label, "Renamed meeting");

const restored = loadNotes({
  getItem: (key) => key === NOTES_STORAGE_KEY ? JSON.stringify(updated) : null,
});
assert.equal(findNotesItem(restored, "note")?.label, "Renamed meeting");

const deletedFolder = removeNotesItem(restored, "project");
assert.equal(findNotesItem(deletedFolder, "project"), undefined);
assert.equal(findNotesItem(deletedFolder, "note"), undefined);

console.log("notes model ok");
