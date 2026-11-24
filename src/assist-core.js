// The command assistant's logic, free of the DOM so Node's test runner and the eval script can use it.
// Order of answers: a fixed recipe, then a deterministic typo fix, then the language model.
import { extras } from "./extras.js";

export const systems = {
  vm: { id: "vm", manager: "apk", os: "Alpine Linux 3.24, 32-bit x86 (musl), running in a browser VM", user: "root, so no sudo" },
  docker: { id: "docker", manager: "apt", os: "Ubuntu 26.04, 64-bit, in a Docker container", user: "dev, with passwordless sudo" },
  macos: { id: "macos", manager: "brew", os: "macOS", user: "a normal user; Homebrew may or may not be installed" },
};

const BREW_INSTALL = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

export function installCommand(sys, pkg) {
  if (sys.manager === "apk") return `apk add ${pkg}`;
  if (sys.manager === "apt") return `sudo apt install -y ${pkg}`;
  return `brew install ${pkg}`;
}

// ---------- small string helpers ----------

/** Damerau-Levenshtein distance (adjacent swaps count as one edit), so "gti" is 1 from "git". */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Edits allowed before a word counts as a typo of another: none for very short words. */
const allowed = len => (len <= 2 ? 0 : len <= 7 ? 1 : 2);

/** The closest word in `vocab` within the allowed edits, or null. Ties keep the earlier word. */
export function nearest(word, vocab) {
  let best = null, bestD = Infinity;
  for (const v of vocab) {
    const d = distance(word, v);
    if (d < bestD && d <= allowed(Math.max(word.length, v.length))) { best = v; bestD = d; }
  }
  return best;
}

// ---------- recipes: exact answers for common requests ----------

const FILLER = /^(please|pls|can you|could you|how do i|how to|i want to|i'd like to|help me|let's|lets)\s+/;
const VOCAB = ["install", "update", "upgrade", "everything", "system", "packages", "switch", "change", "use", "start", "open", "shell", "homebrew", "brew", "oh", "my", "fish", "zsh", "bash", "fisher", "omf", "the", "to", "a", "get", "add", "setup", "set", "up"];

/** Lower case, filler words dropped, and each word snapped to the recipe vocabulary when it's a near miss. */
export function normalize(text) {
  let s = text.toLowerCase().replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  for (let prev; prev !== s;) { prev = s; s = s.replace(FILLER, ""); }
  const names = extras.map(e => e.name.toLowerCase());
  return s.split(" ").map(w => (VOCAB.includes(w) || names.includes(w) ? w : nearest(w, VOCAB) ?? w)).join(" ");
}

const extraByWord = word => extras.find(e => e.name.toLowerCase() === word || e.bin === word)
  ?? extras.find(e => distance(e.name.toLowerCase(), word) <= allowed(word.length));

/**
 * A fixed answer for requests the model gets wrong or that need an exact URL.
 * Returns { cmd, note? } or { no } (a polite "can't here"), or null when no recipe fits.
 */
export function recipe(text, sys) {
  const s = normalize(text);
  const install = s.match(/^(?:install|get|add|setup|set up)\s+(.+)$/);
  const what = install?.[1].replace(/^(the|a)\s+/, "");
  if (what && /^(home ?brew|brew)$/.test(what)) {
    if (sys.id === "vm") return { no: "Homebrew needs 64-bit Linux, and this VM is 32-bit Alpine. Use apk here (apk add <name>), or switch to Docker mode, where brew works." };
    return { cmd: BREW_INSTALL, note: sys.id === "docker" ? "Homebrew's official installer. It installs to /home/linuxbrew; follow the lines it prints at the end to add brew to your PATH." : "Homebrew's official installer." };
  }
  if (what && /^(oh my fish|oh-my-fish|omf)$/.test(what)) {
    if (sys.id !== "macos") return { cmd: "fish", note: "oh-my-fish is already installed. Start fish, then type omf help." };
    return { cmd: `brew install fish && ${extras.find(e => e.name === "oh-my-fish").script}`, note: "Installs fish, then oh-my-fish's installer." };
  }
  if (what && /^(oh my zsh|oh-my-zsh|ohmyzsh)$/.test(what)) return { cmd: extras.find(e => e.name === "oh-my-zsh").script, note: "The oh-my-zsh installer. It needs zsh, git and curl." };
  if (what && /^fisher$/.test(what)) return { cmd: extras.find(e => e.name === "Fisher").script, note: "Installs Fisher inside fish." };
  if (what && /^(zsh|fish|bash)$/.test(what) && sys.id !== "macos") return { cmd: `exec ${what} -l`, note: `${what} is already installed. This starts it now; the Shell menu makes it the default.` };
  if (what && /^[\w.+-]+$/.test(what)) {
    const e = extraByWord(what);
    if (e) {
      const pkg = e[sys.manager];
      if (e.script) return { cmd: e.script, note: `Needs ${e.needs}.` };
      if (!pkg) return { no: `${e.name} isn't packaged for ${sys.manager === "apk" ? "Alpine" : sys.manager}.${sys.id === "vm" ? " Docker mode has it." : ""}` };
      return { cmd: installCommand(sys, pkg), note: e.preinstalled && sys.id !== "macos" ? `${e.name} is already installed.` : e.what };
    }
  }
  if (/^(update|upgrade)(\s+(the\s+)?(everything|system|packages))?$/.test(s) || /^(update|upgrade) (and|&) (update|upgrade)/.test(s)) {
    if (sys.manager === "apk") return { cmd: "apk update && apk upgrade" };
    if (sys.manager === "apt") return { cmd: "sudo apt update && sudo apt upgrade -y" };
    return { cmd: "brew update && brew upgrade" };
  }
  const sw = s.match(/^(?:switch|change|use|start|open)(?:\s+(?:to|the|a))*\s+(zsh|fish|bash)(?:\s+shell)?$/);
  if (sw) return { cmd: `exec ${sw[1]} -l` };
  return null;
}

// ---------- typo fixes without a model ----------

const STOPWORDS = new Set(["the", "a", "an", "in", "of", "to", "my", "this", "that", "all", "for", "with", "called", "and", "from", "on", "is", "are", "what", "which", "how", "me", "every", "into", "named"]);

/** True for plain English ("count the lines in notes.txt"), which goes to the model instead of the typo fixer. */
export function looksLikeSentence(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length >= 3 && words.some(w => STOPWORDS.has(w));
}

const COMMANDS = ["ls", "cd", "pwd", "cat", "less", "more", "head", "tail", "grep", "find", "echo", "touch", "mkdir", "rmdir", "rm", "cp", "mv", "ln", "chmod", "chown", "clear", "exit", "history", "man", "which", "whoami", "uname", "date", "top", "ps", "kill", "killall", "df", "du", "free", "tar", "gzip", "gunzip", "zip", "unzip", "curl", "wget", "ssh", "scp", "ping", "git", "nano", "vi", "vim", "python3", "python", "pip", "node", "npm", "npx", "make", "sudo", "apk", "apt", "apt-get", "brew", "docker", "container", "podman", "sort", "uniq", "wc", "diff", "sed", "awk", "xargs", "env", "export", "source", "alias", "sh", "bash", "zsh", "fish", "omf", "snek", "spf", "opencode", "cheat", "extras", "tree", "tee", "ip", "jq", "file", "stat", "watch", "nc", "dig", "host", "mount", "umount", "lsblk", "lsof", "service", "systemctl", "rc-service", "crontab", "passwd", "su", "id", "hostname", "tr", "cut", "paste", "seq", "sleep", "time", "bc", "base64", "openssl", "rsync", "screen", "emacs", "code", "go", "cargo", "rustc", "java", "ruby", "perl", "php", "gcc", "clang", "test", "true", "false", "type", "command", "jobs", "fg", "bg", "exec", "printf", "read", "set", "unset", "open", "say", "pbcopy", "pbpaste", "defaults", "softwareupdate", "xcode-select", "mas", ...extras.map(e => e.bin).filter(Boolean)];
const SUBCOMMANDS = {
  git: ["status", "add", "commit", "push", "pull", "clone", "checkout", "switch", "branch", "merge", "rebase", "log", "diff", "init", "fetch", "stash", "reset", "remote", "tag", "restore", "show"],
  apt: ["install", "remove", "update", "upgrade", "search", "show", "list", "purge", "autoremove"],
  "apt-get": ["install", "remove", "update", "upgrade", "purge", "autoremove"],
  apk: ["add", "del", "update", "upgrade", "search", "info", "fix"],
  brew: ["install", "uninstall", "update", "upgrade", "search", "info", "list", "doctor", "cleanup", "tap"],
  npm: ["install", "uninstall", "run", "test", "start", "init", "update", "ci", "publish", "list"],
  docker: ["run", "ps", "images", "pull", "build", "exec", "stop", "rm", "rmi", "logs", "compose"],
  pip: ["install", "uninstall", "list", "show", "freeze"],
};

/**
 * Fixes a mistyped command name or a mistyped subcommand of a few well-known tools: "gti stauts" becomes
 * "git status". Returns the fixed line, or null when nothing needed or could be fixed. `known` lists
 * commands that exist on the machine, when the caller knows them.
 */
export function fixTypos(line, known = []) {
  if (looksLikeSentence(line)) return null;
  const m = line.match(/^(\s*(?:sudo\s+)?)(\S+)(.*)$/s);
  if (!m) return null;
  let [, lead, cmd, rest] = m;
  const vocab = [...new Set([...known, ...COMMANDS])];
  let changed = false;
  if (!vocab.includes(cmd)) {
    const fix = nearest(cmd, vocab);
    if (!fix) return null;
    cmd = fix;
    changed = true;
  }
  const subs = SUBCOMMANDS[cmd];
  const sm = subs && rest.match(/^(\s+)(\S+)(.*)$/s);
  if (sm && !subs.includes(sm[2]) && !sm[2].startsWith("-")) {
    const fix = nearest(sm[2], subs);
    if (fix) { rest = sm[1] + fix + sm[3]; changed = true; }
  }
  return changed ? lead + cmd + rest : null;
}

// ---------- the language model ----------

/** Chat messages for the model, with a few worked examples for the current system. */
export function messages(input, sys, { shell = "sh" } = {}) {
  const system = [
    "You turn a request or a mistyped command into one shell command.",
    `System: ${sys.os}. User: ${sys.user}. Shell: ${shell}. Packages: ${sys.manager}.`,
    "Reply with exactly one line: CMD: <command>",
    "If it can't be done on this system, reply with one line: NO: <short reason>",
    "Fix spelling mistakes. Never explain. Never use markdown.",
  ].join("\n");
  const pkg = sys.manager === "apk" ? "apk add" : sys.manager === "apt" ? "sudo apt install -y" : "brew install";
  const shots = [
    ["show the files in this folder with their sizes", "CMD: ls -lh"],
    ["gti stauts", "CMD: git status"],
    ["install python", `CMD: ${pkg} ${sys.manager === "brew" ? "python" : "python3"}`],
    ["find every .log file under this folder", "CMD: find . -name '*.log'"],
  ];
  return [
    { role: "system", content: system },
    ...shots.flatMap(([u, a]) => [{ role: "user", content: u }, { role: "assistant", content: a }]),
    { role: "user", content: input },
  ];
}

/**
 * Reads a model reply: "CMD: x", "NO: reason", or (for models trained to answer with a bare command) the
 * first non-empty line. Returns { cmd } or { no } or null.
 */
export function parseReply(text) {
  const line = String(text).split("\n").map(l => l.trim()).find(l => l && !/^```/.test(l));
  if (!line) return null;
  const no = line.match(/^NO:\s*(.+)$/i);
  if (no) return { no: no[1].trim() };
  let cmd = line.replace(/^CMD:\s*/i, "").replace(/^`+|`+$/g, "").replace(/^\$\s+/, "").trim();
  // Small models like placeholder folders; the current folder is nearly always what was meant.
  cmd = cmd.replace(/(^|\s)\/path\/to\/(directory|folder|dir)\/?(?=\s|$)/g, "$1.");
  if (!cmd || cmd.length > 500) return null;
  return { cmd };
}

// ---------- safety ----------

const DANGERS = [
  [/(^|[;&|]\s*)sudo\b/, "runs as administrator (sudo)"],
  [/\brm\s+(-\S*[rRf]|--recursive|--force)/, "deletes files without asking (rm -r / -f)"],
  [/\bdd\b.*\bof=/, "writes raw data to a disk or file (dd)"],
  [/\bmkfs(\.\w+)?\b/, "formats a disk (mkfs)"],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|python3?)\b/, "runs a script straight from the internet"],
  [/\$\(\s*(curl|wget)\b/, "runs a script straight from the internet"],
  [/>\s*\/dev\/(sd|disk|nvme|hd)/, "writes directly to a disk device"],
  [/\bchmod\s+(-R\s+)?0?777\b/, "makes files writable by everyone (chmod 777)"],
  [/:\(\)\s*\{.*\};\s*:/, "a fork bomb: it freezes the machine"],
  [/\b(shutdown|reboot|halt|poweroff)\b/, "turns off or restarts the machine"],
  [/\bkill(all)?\s+-9\b/, "force-kills processes"],
];

/** Plain-English warnings for risky parts of a command; empty when nothing stands out. */
export function dangers(cmd) {
  return [...new Set(DANGERS.filter(([re]) => re.test(cmd)).map(([, why]) => why))];
}

// ---------- the shell hook ----------

/** OSC 7777 payload from the shells' command-not-found hooks: "assist;<base64 of the typed line>". */
export function parseHook(data) {
  const m = /^assist;([A-Za-z0-9+/=]*)$/.exec(data);
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[1]), c => c.charCodeAt(0));
    const line = new TextDecoder().decode(bytes).trim();
    return line && line.length <= 1000 ? line : null;
  } catch {
    return null;
  }
}

/**
 * Everything short of the model: a recipe, or a typo fix when the text looks like a command.
 * Returns { cmd, note?, source } or { no, source }, or null when the model has to answer.
 */
export function quickAnswer(text, sys, known) {
  const r = recipe(text, sys);
  if (r) return { ...r, source: "recipe" };
  const fixed = fixTypos(text, known);
  if (fixed) return { cmd: fixed, note: "Spelling fixed.", source: "typo" };
  return null;
}
