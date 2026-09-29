import { MousePointer2, Pencil, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ShortcutAction, ShortcutBinding, ShortcutConfig } from "@/types";

export type ShortcutRow = {
  action: ShortcutAction;
  title: string;
  description: string;
};

function keyboardLabel(event: KeyboardEvent) {
  const labels: Record<string, string> = {
    AltLeft: "Alt", AltRight: "Alt", Backspace: "Backspace", CapsLock: "Caps Lock",
    ControlLeft: "Ctrl", ControlRight: "Ctrl", Delete: "Delete", Enter: "Enter",
    Escape: "Esc", MetaLeft: "Win", MetaRight: "Win", ShiftLeft: "Shift",
    ShiftRight: "Shift", Space: "Space", Tab: "Tab",
  };
  if (labels[event.code]) return labels[event.code];
  if (event.code.startsWith("Key")) return event.code.slice(3);
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  if (event.code.startsWith("Numpad")) return `Num ${event.code.slice(6)}`;
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

export function ShortcutEditor({
  rows,
  config,
  onChange,
  onStatus,
  showHint = true,
}: {
  rows: ShortcutRow[];
  config: ShortcutConfig | null;
  onChange: (config: ShortcutConfig) => void;
  onStatus: (message: string) => void;
  showHint?: boolean;
}) {
  const [editingAction, setEditingAction] = useState<ShortcutAction | null>(null);
  const [candidate, setCandidate] = useState<ShortcutBinding | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heldKeys = useRef(new Map<number, string>());

  useEffect(() => {
    if (!editingAction) return;
    const captureKeyboard = (event: KeyboardEvent) => {
      const keyCode = event.keyCode || event.which;
      if (!keyCode) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey) heldKeys.current.set(0x11, "Ctrl");
      if (event.shiftKey) heldKeys.current.set(0x10, "Shift");
      if (event.altKey) heldKeys.current.set(0x12, "Alt");
      if (event.metaKey) heldKeys.current.set(0x5b, "Win");
      heldKeys.current.set(keyCode, keyboardLabel(event));
      setCandidate({ keys: [...heldKeys.current.keys()], label: [...heldKeys.current.values()].join(" + ") });
      setError("");
    };
    const releaseKeyboard = (event: KeyboardEvent) => heldKeys.current.delete(event.keyCode || event.which);
    const unsubscribe = window.localflow.onShortcutCaptured((binding) => {
      setCandidate(binding);
      setError("");
    });
    void window.localflow.setShortcutCapture(true).catch((captureError) => {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    });
    const cancelOnBlur = () => setEditingAction(null);
    window.addEventListener("keydown", captureKeyboard, true);
    window.addEventListener("keyup", releaseKeyboard, true);
    window.addEventListener("blur", cancelOnBlur);
    return () => {
      window.removeEventListener("keydown", captureKeyboard, true);
      window.removeEventListener("keyup", releaseKeyboard, true);
      window.removeEventListener("blur", cancelOnBlur);
      unsubscribe();
      void window.localflow.setShortcutCapture(false).catch(() => {});
      heldKeys.current.clear();
    };
  }, [editingAction]);

  const beginEdit = (action: ShortcutAction) => {
    heldKeys.current.clear();
    setCandidate(null);
    setError("");
    setEditingAction(action);
  };
  const cancelEdit = () => {
    setEditingAction(null);
    setCandidate(null);
    setError("");
  };
  const saveShortcut = async () => {
    if (!editingAction || !candidate) return;
    setSaving(true);
    setError("");
    try {
      const next = await window.localflow.setShortcut({ action: editingAction, binding: candidate });
      onChange(next);
      onStatus("Shortcut saved");
      cancelEdit();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="shortcutList">
        {rows.map((row) => {
          const editing = editingAction === row.action;
          return (
            <article className={editing ? "editing" : ""} key={row.action}>
              <div className="shortcutSummary"><strong>{row.title}</strong><span>{row.description}</span></div>
              {editing ? (
                <div className="shortcutCapture" aria-live="polite">
                  {candidate ? <kbd>{candidate.label}</kbd> : <span>Press shortcut…</span>}
                </div>
              ) : (
                <kbd className="shortcutBinding">{config ? config[row.action]?.label || "Not assigned" : "Loading…"}</kbd>
              )}
              <div className="shortcutEditActions">
                {editing ? (
                  <>
                    <button onClick={saveShortcut} disabled={!candidate || saving} className="primary"><Save size={15} /> Save</button>
                    <button onClick={cancelEdit} disabled={saving} aria-label="Cancel shortcut edit" title="Cancel"><X size={15} /></button>
                  </>
                ) : (
                  <button onClick={() => beginEdit(row.action)} disabled={!config}><Pencil size={15} /> Edit</button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {showHint ? (
        <div className="shortcutHint"><MousePointer2 size={16} /><span>Mouse Back and Mouse Forward are supported. Left, right, middle click and wheel input are ignored.</span></div>
      ) : null}
      {error ? <div className="errorBox">{error}</div> : null}
    </>
  );
}
