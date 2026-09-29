import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

async function render() {
  // Apply the saved palette before first paint, without waiting for any model.
  let theme = "dark";
  try { theme = await window.localflow?.getAppearance?.() || theme; }
  catch (error) { console.warn("Could not load appearance", error); }
  document.documentElement.dataset.theme = theme;
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>
  );
}
void render();
