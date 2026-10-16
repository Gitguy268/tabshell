import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Saved VMs only restore on the image they were saved from, so the build records which image it ships.
let imageId = "none";
try { imageId = createHash("sha256").update(readFileSync("public/alpine/fs.json")).digest("hex").slice(0, 16); } catch {}

// Relative base so the same build works on GitHub Pages (/tabshell/) and from start.command (/).
export default defineConfig({
  base: "./",
  define: { __IMAGE_ID__: JSON.stringify(imageId) },
  server: { port: 8690 },
  build: { target: "es2022", chunkSizeWarningLimit: 1000 },
});
