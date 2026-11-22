// The Ask panel: plain English or a mistyped command in, one confirmed command out.
// Recipes and typo fixes answer at once; anything else goes to a small GGUF model run in the page by wllama.
// The model downloads only when asked, once, and stays in the browser's cache. Nothing runs without a click or Enter.
import { systems, quickAnswer, messages, parseReply, dangers } from "./assist-core.js";

const hf = (repo, rev, file) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;
// Scores from scripts/assist-eval.mjs (42 cases), with recipes and typo fixes in front; see the README.
export const MODELS = [
  { id: "nl2bash", label: "Qwen2.5-Coder 0.5B NL2Bash (recommended)", repo: "burhan2753y/qwen2.5-coder-0.5b-nl2bash-gguf", size: 531_067_680,
    url: hf("burhan2753y/qwen2.5-coder-0.5b-nl2bash-gguf", "e90ecc62835f8def136688757dfbd8e5a5a667fa", "qwen2.5-coder-0.5b-bash-gguf.gguf") },
  { id: "qwen-coder", label: "Qwen2.5-Coder 0.5B Instruct", repo: "Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF", size: 491_400_064,
    url: hf("Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF", "ebb2015119c907b064c512bf053e945850b5875f", "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf") },
  { id: "k2-system1", label: "K2-Horizon 0.9B System 1", repo: "Lucasgitguy-co/K2-Horizon-0.9B-System1-GGUF", size: 666_194_336,
    url: hf("Lucasgitguy-co/K2-Horizon-0.9B-System1-GGUF", "f367c4d90a942e9f092e390650de76fc37bf2426", "K2-Horizon-0.9B-System1-Q4_K_M.gguf") },
];
const mb = n => `${Math.round(n / 1e6)} MB`;

/**
 * Wires the #ask panel. `run(cmd)` types a confirmed command into the shell; `context()` gives
 * { mode: "vm" | "docker", shell } for the system prompt.
 */
export function createAssist({ store, run, context, focusTerminal, refit }) {
  const $ = s => document.querySelector(s);
  const panel = $("#ask"), input = $("#ask-input"), result = $("#ask-result"), note = $("#ask-note");
  const runRow = $("#ask-run"), cmdBox = $("#ask-cmd"), warn = $("#ask-warn");
  const offer = $("#ask-download"), offerText = $("#ask-download-text"), progress = $("#ask-progress");
  const modelSelect = $("#ask-model"), hookBox = $("#ask-hook");

  let modelId = MODELS.some(m => m.id === store.get("assist-model")) ? store.get("assist-model") : MODELS[0].id;
  let engine = null; // { wllama, id } once a model is loaded
  let loading = null; // the load in progress
  let asking = null; // AbortController of the running question
  let pending = null; // the text waiting for the model to finish downloading

  for (const m of MODELS) modelSelect.add(new Option(`${m.label} · ${mb(m.size)}`, m.id));
  modelSelect.value = modelId;
  hookBox.checked = store.get("assist-hook") !== "off";
  hookBox.addEventListener("change", () => store.set("assist-hook", hookBox.checked ? null : "off"));
  modelSelect.addEventListener("change", () => {
    modelId = modelSelect.value;
    store.set("assist-model", modelId === MODELS[0].id ? null : modelId);
    if (engine && engine.id !== modelId) { engine.wllama.exit().catch(() => {}); engine = null; }
  });

  const model = () => MODELS.find(m => m.id === modelId);
  const sys = () => systems[context().mode] ?? systems.vm;

  function show(open) {
    panel.hidden = !open;
    $("#ask-btn").setAttribute("aria-expanded", open);
    refit();
  }
  function clearResult() {
    result.hidden = true;
    runRow.hidden = true;
    offer.hidden = true;
    warn.replaceChildren();
    note.textContent = "";
    note.className = "";
  }
  function close() {
    asking?.abort();
    pending = null;
    clearResult();
    show(false);
    focusTerminal();
  }

  function say(text, kind = "") {
    result.hidden = false;
    note.textContent = text;
    note.className = kind;
  }

  /** Shows a command to confirm. It's editable, and warnings update as it changes. */
  function propose(cmd, why, { focus = true } = {}) {
    clearResult();
    say(why || "Run this command?");
    runRow.hidden = false;
    cmdBox.value = cmd;
    updateWarnings();
    if (focus) { cmdBox.focus(); cmdBox.select(); }
  }
  function updateWarnings() {
    warn.replaceChildren(...dangers(cmdBox.value).map(w => Object.assign(document.createElement("li"), { textContent: "Careful: " + w })));
  }
  cmdBox.addEventListener("input", updateWarnings);

  function answer(a, opts) {
    if (a.no) { clearResult(); say(a.no, "muted"); return; }
    propose(a.cmd, a.note, opts);
  }

  async function wllamaFor() {
    const [{ Wllama }, { default: wasm }] = await Promise.all([import("@wllama/wllama"), import("@wllama/wllama/esm/wasm/wllama.wasm?url")]);
    return new Wllama({ default: wasm }, { suppressNativeLog: true, allowOffline: true });
  }

  /** True when the chosen model is already in the browser's cache, so it loads without asking. */
  async function cached() {
    try { return !!(await (await wllamaFor()).cacheManager.open(model().url)); } catch { return false; }
  }

  function load() {
    if (engine?.id === modelId) return Promise.resolve(engine);
    if (loading) return loading;
    const m = model();
    progress.hidden = false;
    progress.value = 0;
    loading = (async () => {
      const wllama = await wllamaFor();
      await wllama.loadModelFromUrl(m.url, {
        n_ctx: 1024,
        useCache: true,
        progressCallback: ({ loaded, total }) => { progress.value = total ? loaded / total : 0; },
      });
      engine = { wllama, id: m.id };
      return engine;
    })().finally(() => { loading = null; progress.hidden = true; });
    return loading;
  }

  function offerDownload(text) {
    pending = text;
    clearResult();
    const m = model();
    offer.hidden = false;
    offerText.textContent = `This needs the assistant model: ${m.label}, ${mb(m.size)} from Hugging Face (${m.repo}, Apache-2.0). It downloads once, stays in this browser and runs here; your words never leave the page.`;
    refit();
  }

  async function askModel(text, opts) {
    asking?.abort();
    const controller = asking = new AbortController();
    clearResult();
    say(loading ? "Loading the model…" : "Thinking…", "muted");
    try {
      const { wllama } = await load();
      if (controller.signal.aborted) return;
      say("Thinking…", "muted");
      const res = await wllama.createChatCompletion({
        messages: messages(text, sys(), { shell: context().shell }),
        temperature: 0,
        max_tokens: 80,
        abortSignal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const a = parseReply(res.choices?.[0]?.message?.content ?? "");
      if (!a) return say("No suggestion for that. Try saying it another way.", "muted");
      answer({ ...a, note: a.cmd ? "Suggested by the model. Check it before running." : undefined }, opts);
    } catch (err) {
      if (controller.signal.aborted) return;
      say("The model couldn't run: " + (err?.message || err), "error");
    } finally {
      if (asking === controller) asking = null;
    }
  }

  /** Answers `text`: a recipe or typo fix at once, otherwise the model (after a download offer the first time). */
  async function suggest(text, opts = {}) {
    text = text.trim();
    if (!text) return;
    const quick = quickAnswer(text, sys());
    if (quick) return answer(quick, opts);
    if (engine?.id === modelId || loading || (await cached())) return askModel(text, opts);
    offerDownload(text);
  }

  $("#ask-get").addEventListener("click", () => {
    const text = pending ?? input.value;
    pending = null;
    offer.hidden = true;
    askModel(text);
  });

  panel.addEventListener("submit", e => { e.preventDefault(); suggest(input.value); });
  $("#ask-go").addEventListener("click", () => confirmRun());
  $("#ask-cancel").addEventListener("click", close);
  $("#ask-close").addEventListener("click", close);
  cmdBox.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); confirmRun(); } });
  panel.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); close(); } });

  function confirmRun() {
    const cmd = cmdBox.value.trim();
    if (!cmd) return;
    run(cmd);
    input.value = "";
    close();
  }

  return {
    /** Opens the panel; with text, answers it straight away. */
    open(text) {
      show(true);
      if (text != null) { input.value = text; suggest(text); }
      else { clearResult(); input.focus(); input.select(); }
    },
    toggle() { panel.hidden ? this.open() : close(); },
    /** Shows a ready-made command for confirmation, e.g. from the Extras panel. */
    confirm(cmd, why) { show(true); input.value = ""; propose(cmd, why); },
    /** The shell couldn't find a command: offer a fix, unless turned off. Doesn't steal focus for a download offer. */
    fromHook(line) {
      if (!hookBox.checked) return;
      show(true);
      input.value = line;
      suggest(line, { focus: true });
    },
    get modelLoaded() { return !!engine; },
  };
}
