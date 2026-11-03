import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { startVm, DEFAULT_RELAY } from "./vm.js";
import { startDocker, dockerAvailable } from "./docker.js";
import { themes } from "./themes.js";

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
});

// Themes. "system" follows the OS between Default and Light.
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const choiceOf = id => id === "system" || Object.hasOwn(themes, id) ? id : "default";
const resolve = choice => choice === "system" ? (darkQuery.matches ? "default" : "light") : choice;
let themeChoice = choiceOf(store.get("theme"));
let quotes = [], quoteAt = 0;

const favicon = ({ bg, accent, text }) => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${bg}"/>` +
  `<path d="M8 10l6 6-6 6" stroke="${accent}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="M16 23h8" stroke="${text}" stroke-width="3" stroke-linecap="round"/></svg>`);

// The page's colours before the scripts load come from this, so a reload doesn't flash the Default theme (see index.html).
const paintOf = name => ({ ...themes[name].css, scheme: themes[name].scheme });
function rememberPaint(choice) {
  const dark = paintOf(choice === "system" ? "default" : choice);
  const light = choice === "system" ? paintOf("light") : dark;
  store.set("theme-paint", JSON.stringify({ dark, light }));
}

function showQuote() {
  const quote = $("#quote");
  quote.hidden = !quotes.length;
  if (!quotes.length) return;
  quote.textContent = quotes[quoteAt % quotes.length];
  quote.title = quote.textContent + (quotes.length > 1 ? " (click for another)" : "");
  quote.disabled = quotes.length < 2;
}

function applyTheme() {
  const name = resolve(themeChoice);
  const { xterm, css, scheme } = themes[name];
  term.options.theme = xterm;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(css)) root.style.setProperty("--" + key, value);
  root.style.colorScheme = scheme;
  root.dataset.theme = name;
  $('meta[name="theme-color"]').content = css.panel;
  $('link[rel="icon"]').href = favicon(css);
  if (quotes !== themes[name].quotes) {
    quotes = themes[name].quotes;
    quoteAt = Math.floor(Math.random() * quotes.length);
  }
  showQuote();
  $("#theme").value = themeChoice;
}

for (const [id, { label }] of Object.entries(themes)) $("#theme").add(new Option(label, id));
$("#theme").add(new Option("Match system", "system"), $("#theme").options[1]);
applyTheme();
rememberPaint(themeChoice);
darkQuery.addEventListener("change", () => { if (themeChoice === "system") applyTheme(); });
$("#theme").addEventListener("change", e => {
  themeChoice = choiceOf(e.target.value);
  store.set("theme", themeChoice === "default" ? null : themeChoice);
  rememberPaint(themeChoice);
  applyTheme();
  term.focus();
});
$("#quote").addEventListener("click", e => {
  quoteAt++;
  showQuote();
  if (e.detail) term.focus(); // keyboard presses (detail 0) keep focus here, to step through the lines
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
// Binary data (old-style mouse reports) is one byte per character, not UTF-8.
term.onBinary(data => backend?.send(Uint8Array.from(data, c => c.charCodeAt(0) & 0xff)));
term.onResize(() => backend?.resize());

function start() {
  term.reset();
  for (const b of document.querySelectorAll(".modes button")) b.setAttribute("aria-checked", b.dataset.mode === mode);
  $("#settings-btn").hidden = mode !== "vm";
  if (mode !== "vm") toggleSettings(false);
  backend = mode === "vm" ? startVm(term, { relay: store.get("relay"), onStatus }) : startDocker(term, { onStatus });
  term.focus();
}

// One switch, reset or restart at a time: overlapping ones would leave two machines writing to the terminal.
let busy = false;
async function exclusive(fn) {
  if (busy) return;
  busy = true;
  for (const el of document.querySelectorAll(".modes button, #reset, #settings button")) el.disabled = true;
  try {
    await fn();
  } finally {
    busy = false;
    for (const el of document.querySelectorAll(".modes button, #reset, #settings button")) el.disabled = false;
  }
}

async function stopBackend(message) {
  const old = backend;
  backend = null;
  onStatus(message);
  try { await old?.stop(); } catch (err) { console.warn("TabShell: stopping failed", err); }
}

const switchTo = next => exclusive(async () => {
  if (next === mode) return;
  if (next === "docker") {
    const s = await dockerAvailable();
    if (!s) return onStatus("Docker mode needs the local app: download TabShell and double-click start.command.");
    if (!s.docker) return onStatus("Docker isn't running. Start Docker Desktop (or `container system start`), then try again.");
    if (!s.image) return onStatus("The Ubuntu image isn't built yet. Restart start.command to build it.");
  }
  await stopBackend("Saving…");
  mode = next;
  store.set("mode", mode);
  start();
});

for (const b of document.querySelectorAll(".modes button")) b.addEventListener("click", () => switchTo(b.dataset.mode));

$("#clear").addEventListener("click", () => { term.clear(); term.focus(); });

const dialog = $("#confirm");
$("#reset").addEventListener("click", () => {
  if (busy) return;
  $("#confirm-name").textContent = mode === "vm" ? "the Browser VM" : "the Docker container";
  dialog.returnValue = "";
  dialog.showModal();
});
dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "ok") return term.focus();
  exclusive(async () => {
    const old = backend;
    backend = null;
    term.reset();
    onStatus("Resetting…");
    let failure = null;
    try { await old?.reset(); } catch (err) { failure = err; }
    // Start again either way, so a failed reset doesn't leave a dead terminal.
    start();
    if (failure) {
      onStatus("Reset failed: " + failure.message);
      term.write(`\x1b[2m[Reset failed: ${failure.message}. This is the machine as it was.]\x1b[0m\r\n`);
    }
  });
});

const settings = $("#settings");
function toggleSettings(show = settings.hidden) {
  settings.hidden = !show;
  $("#settings-btn").setAttribute("aria-expanded", show);
  requestAnimationFrame(() => fit.fit());
}
$("#relay").value = store.get("relay") || "";
$("#relay").placeholder = DEFAULT_RELAY;
$("#settings-btn").addEventListener("click", () => toggleSettings());
settings.addEventListener("submit", e => {
  e.preventDefault();
  const value = $("#relay").value.trim();
  if (value && !/^(wss?|wisps?):\/\/[^/\s]/.test(value)) return onStatus("The relay address must start with ws://, wss://, wisp:// or wisps://");
  exclusive(async () => {
    store.set("relay", value || null);
    toggleSettings(false);
    await stopBackend("Saving…");
    start();
  });
});

// The page only knows Docker is possible when start.command serves it.
dockerAvailable().then(s => { if (!s) $('[data-mode="docker"]').title += " (only when run locally with start.command)"; });
if (mode === "docker") exclusive(async () => { if (!(await dockerAvailable())?.image) { mode = "vm"; store.set("mode", "vm"); } start(); });
else start();
