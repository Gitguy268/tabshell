import { defineConfig } from "vite";

// Relative base so the same build works on GitHub Pages (/tabshell/) and from start.command (/).
export default defineConfig({
  base: "./",
  server: { port: 8690 },
  build: { target: "es2022", chunkSizeWarningLimit: 1000 },
});
