import { useState } from "react";
import { Check } from "lucide-react";
import type { AppearanceTheme } from "../types";

const themes: { id: AppearanceTheme; label: string; description: string }[] = [
  { id: "dark", label: "Dark glass", description: "Dark, translucent surfaces" },
  { id: "light", label: "Light glass", description: "Light, translucent surfaces" },
  { id: "static-black", label: "Pure black", description: "Solid black. No transparency." },
  { id: "static-white", label: "Pure white", description: "Solid white. No transparency." },
];

export function AppearanceSettings() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "dark");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function selectTheme(next: AppearanceTheme) {
    setSaving(true);
    setError("");
    try {
      const saved = await window.localflow.setAppearance(next);
      document.documentElement.dataset.theme = saved;
      setTheme(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save appearance");
    } finally { setSaving(false); }
  }

  return <section className="settingsGroup appearanceGroup" aria-labelledby="appearance-heading">
    <div className="settingsGroupHeading">
      <strong id="appearance-heading">Appearance</strong>
    </div>
    <div className="appearanceGrid" role="group" aria-label="Theme">
      {themes.map(option => <button key={option.id} className="appearanceCard" data-theme-option={option.id}
        aria-pressed={theme === option.id} disabled={saving} onClick={() => void selectTheme(option.id)}>
        <span className={`themeThumbnail themeThumbnail-${option.id}`} aria-hidden="true">
          <i /><span><b /><b /><em /></span>
        </span>
        <strong>{option.label}</strong><small>{option.description}</small>
        {theme === option.id && <Check className="themeCheck" size={14} aria-hidden="true" />}
      </button>)}
    </div>
    {error && <p className="errorBox" role="alert">{error}</p>}
  </section>;
}
