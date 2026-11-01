import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { desktopReady } from './lib/desktop';

// The native initialization script sets the saved palette synchronously.
document.documentElement.dataset.theme = Reflect.get(window, '__LOCALFLOW_THEME') || 'dark';
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
requestAnimationFrame(() => requestAnimationFrame(() => { void desktopReady().catch(console.error); }));
