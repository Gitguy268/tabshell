import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { startVm, DEFAULT_RELAY } from "./vm.js";
import { startDocker, dockerAvailable } from "./docker.js";

const $ = s => document.querySelector(s);
const status = $("#status");
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const term = new Terminal({
  cursorBlink: true,
  scrollback: 5000,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 14,
  theme: { background: "#0d1117", foreground: "#e6edf3", cursor: "#5fd68a", selectionBackground: "#264f78" },
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open($("#term"));

// GPU renderer. If WebGL is missing or the context is lost, xterm.js falls back to its DOM renderer.
window.tabshell = { term, renderer: "dom" }; // handle for the end-to-end test and for poking around in devtools
try {
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => { webgl.dispose(); window.tabshell.renderer = "dom"; });
  term.loadAddon(webgl);
  window.tabshell.renderer = "webgl";
} catch (err) {
  console.warn("TabShell: WebGL renderer unavailable, using DOM renderer", err);
}
fit.fit();
new ResizeObserver(() => fit.fit()).observe($("#term"));

let mode = store.get("mode") === "docker" ? "docker" : "vm";
let backend = null;
const onStatus = text => { status.textContent = text; };

term.onData(data => backend?.send(data));
term.onBinary(data => backend?.send(data));
term.onResize(() => backend?.resize());

function start() {
  term.reset();
  for (const b of document.querySelectorAll(".modes button")) b.setAttribute("aria-checked", b.dataset.mode === mode);
  $("#settings-btn").hidden = mode !== "vm";
  backend = mode === "vm" ? startVm(term, { relay: store.get("relay"), onStatus }) : startDocker(term, { onStatus });
  term.focus();
}

async function switchTo(next) {
  if (next === mode) return;
  if (next === "docker") {
    const s = await dockerAvailable();
    if (!s) return onStatus("Docker mode needs the local app: download TabShell and double-click start.command.");
    if (!s.docker) return onStatus("Docker isn't running. Start Docker Desktop, then try again.");
    if (!s.image) return onStatus("The Ubuntu image isn't built yet. Restart start.command to build it.");
  }
  const old = backend;
  backend = null;
  onStatus("Saving…");
  await old?.stop();
  mode = next;
  store.set("mode", mode);
  start();
}

for (const b of document.querySelectorAll(".modes button")) b.addEventListener("click", () => switchTo(b.dataset.mode));

$("#clear").addEventListener("click", () => { term.clear(); term.focus(); });

const dialog = $("#confirm");
$("#reset").addEventListener("click", () => {
  $("#confirm-name").textContent = mode === "vm" ? "the Browser VM" : "the Docker container";
  dialog.returnValue = "";
  dialog.showModal();
});
dialog.addEventListener("close", async () => {
  if (dialog.returnValue !== "ok") return term.focus();
  const old = backend;
  backend = null;
  term.reset();
  onStatus("Resetting…");
  try {
    await old?.reset();
  } catch (err) {
    onStatus("Reset failed: " + err.message);
    return;
  }
  start();
});

const settings = $("#settings");
$("#relay").value = store.get("relay") || "";
$("#relay").placeholder = DEFAULT_RELAY;
$("#settings-btn").addEventListener("click", e => {
  settings.hidden = !settings.hidden;
  e.currentTarget.setAttribute("aria-expanded", !settings.hidden);
  requestAnimationFrame(() => fit.fit());
});
settings.addEventListener("submit", async e => {
  e.preventDefault();
  const value = $("#relay").value.trim();
  if (value && !/^(wss?|wisps?):\/\//.test(value)) return onStatus("The relay address must start with ws://, wss://, wisp:// or wisps://");
  store.set("relay", value || null);
  settings.hidden = true;
  const old = backend;
  backend = null;
  await old?.stop();
  start();
});

// The page only knows Docker is possible when start.command serves it.
dockerAvailable().then(s => { if (!s) $('[data-mode="docker"]').title += " (only when run locally with start.command)"; });
if (mode === "docker") dockerAvailable().then(s => { if (!s?.image) { mode = "vm"; store.set("mode", "vm"); } start(); });
else start();
