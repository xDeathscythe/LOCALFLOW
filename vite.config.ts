import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  base: "./",
  // An open desktop window may still lazy-load chunks from the previous build.
  build: mode === 'release' ? { outDir: 'runtime/release-ui', emptyOutDir: true } : { emptyOutDir: false },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      { find: /^katex$/, replacement: fileURLToPath(new URL("./src/lib/lazy-math.ts", import.meta.url)) },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
}));
