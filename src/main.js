import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { startVm, DEFAULT_RELAY } from "./vm.js";
import { startDocker, dockerAvailable } from "./docker.js";
import { themes } from "./themes.js";
import { createAssist } from "./assist.js";
import { parseHook, systems, installCommand } from "./assist-core.js";
import { extras } from "./extras.js";
import { cheatsheet } from "./cheatsheet.js";

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
// After a panel opens or closes, fit to the new size and repaint every row.
const refit = () => { fit.fit(); term.refresh(0, term.rows - 1); };
new ResizeObserver(refit).observe($("#term"));

let mode = store.get("mode") === "docker" ? "docker" : "vm";
let backend = null;
const onStatus = text => { status.textContent = text; };

// Shells. The images keep ash (Browser VM) or bash (Docker) as the login shell. The first login shell of a
// session reports itself (OSC 7777 "ready;<name>", see image/shell/profile.sh), and the page then starts
// the shell picked here. Ctrl+U first clears anything half-typed on the line.
const SHELLS = ["default", "bash", "zsh", "fish"];
let shellChoice = SHELLS.includes(store.get("shell")) ? store.get("shell") : "default";
let currentShell = null;
const wantedShell = () => (shellChoice === "default" ? (mode === "vm" ? "sh" : "bash") : shellChoice);
function startShell(name) {
  currentShell = name;
  backend?.send(`\x15exec ${name} -l\r`);
}
$("#shell").value = shellChoice;
$("#shell").addEventListener("change", e => {
  shellChoice = SHELLS.includes(e.target.value) ? e.target.value : "default";
  store.set("shell", shellChoice === "default" ? null : shellChoice);
  if (backend && wantedShell() !== currentShell) startShell(wantedShell());
  term.focus();
});

const assist = createAssist({
  store,
  run: cmd => { backend?.send(`\x15${cmd}\r`); },
  context: () => ({ mode, shell: currentShell ?? wantedShell() }),
  focusTerminal: () => term.focus(),
  refit: () => requestAnimationFrame(refit),
});
window.tabshell.assist = assist;

term.parser.registerOscHandler(7777, data => {
  if (data.startsWith("ready;")) {
    currentShell = data.slice(6);
    if (wantedShell() !== currentShell) startShell(wantedShell());
  } else {
    const line = parseHook(data);
    if (line) assist.fromHook(line);
  }
  return true;
});

// Ctrl+Shift+Space opens Ask from the terminal too; xterm.js would otherwise send it to the shell.
const isAskKey = e => e.type === "keydown" && e.ctrlKey && e.shiftKey && e.code === "Space";
term.attachCustomKeyEventHandler(e => {
  if (!isAskKey(e)) return true;
  e.preventDefault();
  assist.toggle();
  return false;
});
document.addEventListener("keydown", e => { if (isAskKey(e) && !e.defaultPrevented) { e.preventDefault(); assist.toggle(); } });
$("#ask-btn").addEventListener("click", () => assist.toggle());

// Extras and Cheatsheet drawers: one open at a time.
const drawers = { extras: $("#extras"), cheat: $("#cheat") };
function toggleDrawer(name, show = drawers[name].hidden) {
  for (const [n, el] of Object.entries(drawers)) {
    el.hidden = n === name ? !show : true;
    $(`#${n}-btn`).setAttribute("aria-expanded", !el.hidden);
  }
  if (name === "extras" && show) renderExtras();
  requestAnimationFrame(refit);
}
$("#extras-btn").addEventListener("click", () => toggleDrawer("extras"));
$("#cheat-btn").addEventListener("click", () => toggleDrawer("cheat"));
for (const d of Object.values(drawers)) d.addEventListener("keydown", e => { if (e.key === "Escape") { toggleDrawer("extras", false); term.focus(); } });

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
function renderExtras() {
  const sys = systems[mode];
  const groups = new Map();
  for (const e of extras) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);
  $("#extras-list").replaceChildren(...[...groups].map(([group, items]) => el("div", { className: "extras-group" },
    el("h3", { textContent: group }),
    ...items.map(e => {
      const cmd = e.script ?? (e[sys.manager] ? installCommand(sys, e[sys.manager]) : null);
      const button = el("button", { type: "button", textContent: e.preinstalled ? "Installed" : cmd ? "Install" : "Not here", disabled: !cmd || e.preinstalled });
      if (e.preinstalled) button.title = "Already in this image";
      else if (!cmd) button.title = `Not packaged for ${mode === "vm" ? "Alpine" : "Ubuntu"}`;
      button.addEventListener("click", () => { toggleDrawer("extras", false); assist.confirm(cmd, e.needs ? `${e.what} Needs ${e.needs}.` : e.what); });
      return el("div", { className: "extra" },
        el("a", { href: e.url, target: "_blank", rel: "noopener", textContent: e.name }),
        el("span", { textContent: e.what }),
        button);
    }))));
}
$("#cheat-list").replaceChildren(...cheatsheet.map(([title, rows]) => el("div", { className: "cheat-group" },
  el("h3", { textContent: title }),
  el("dl", {}, ...rows.flatMap(([keys, what]) => [el("dt", {}, el("kbd", { textContent: keys })), el("dd", { textContent: what })])))));

term.onData(data => backend?.send(data));
// Binary data (old-style mouse reports) is one byte per character, not UTF-8.
term.onBinary(data => backend?.send(Uint8Array.from(data, c => c.charCodeAt(0) & 0xff)));
term.onResize(() => backend?.resize());

function start() {
  term.reset();
  currentShell = null;
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
  requestAnimationFrame(refit);
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
