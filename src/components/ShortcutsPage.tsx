import { Keyboard } from "lucide-react";
import { ShortcutEditor, type ShortcutRow } from "./ShortcutEditor";
import type { ShortcutConfig } from "@/types";

const fixedRows: ShortcutRow[] = [
  { action: 'niwa-agent', title: 'Talk to Niwa', description: 'Toggle duplex voice, or record with the selected local voice mode.' },
  { action: "dictation", title: "Quick dictation", description: "Start and stop dictation using the recording mode selected in Settings." },
  { action: "import-audio", title: "Import audio", description: "Open the local audio file picker." },
  { action: "reset-session", title: "Reset session", description: "Clear the current transcript and recording state." },
];

export function ShortcutsPage({
  config,
  onChange,
  onStatus,
}: {
  config: ShortcutConfig | null;
  onChange: (config: ShortcutConfig) => void;
  onStatus: (message: string) => void;
}) {
  return (
    <section className="utilityPanel shortcutsPanel">
      <header><Keyboard size={24} /><div><h2>Shortcuts</h2><p>Every LocalFlow and Niwa voice shortcut is managed here.</p></div></header>
      <ShortcutEditor
        rows={fixedRows}
        config={config}
        onChange={onChange}
        onStatus={onStatus}
      />
    </section>
  );
}
