import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { systems, recipe, fixTypos, quickAnswer, parseReply, dangers, parseHook, messages, distance, looksLikeSentence } from "../src/assist-core.js";
import { extras } from "../src/extras.js";
import { renderExtras, renderCheat } from "../scripts/gen-shell.mjs";

const { vm, docker, macos } = systems;
const b64 = s => Buffer.from(s).toString("base64");

test("distance counts a swap as one edit", () => {
  assert.equal(distance("gti", "git"), 1);
  assert.equal(distance("stauts", "status"), 1);
  assert.equal(distance("brew", "brew"), 0);
});

test("install brew gets the right answer on each system", () => {
  assert.ok(recipe("install brew", vm).no.includes("32-bit"));
  for (const sys of [docker, macos]) assert.match(recipe("install brew", sys).cmd, /Homebrew\/install\/HEAD\/install\.sh/);
  assert.match(recipe("Please instal homebrew?", macos).cmd, /Homebrew/);
  assert.match(recipe("how do i install brew", docker).cmd, /Homebrew/);
});

test("install recipes use each system's package manager and names", () => {
  assert.equal(recipe("install ripgrep", vm).cmd, "apk add ripgrep");
  assert.equal(recipe("installl htop", docker).cmd, "sudo apt install -y htop");
  assert.equal(recipe("install the_silver_searcher", docker).cmd, "sudo apt install -y silversearcher-ag");
  assert.equal(recipe("install tldr", macos).cmd, "brew install tlrc");
  assert.ok(recipe("install tldr", vm).no);
  assert.match(recipe("install fzf", vm).note, /already installed/);
});

test("shell and oh-my-fish recipes", () => {
  assert.equal(recipe("use zsh", vm).cmd, "exec zsh -l");
  assert.equal(recipe("switch to the fish shell", docker).cmd, "exec fish -l");
  assert.equal(recipe("install oh my fish", vm).cmd, "fish");
  assert.match(recipe("install oh-my-fish", macos).cmd, /^brew install fish && curl .*oh-my-fish.*\| fish$/);
  assert.match(recipe("install oh my zsh", docker).cmd, /ohmyzsh/);
  assert.equal(recipe("update everything", docker).cmd, "sudo apt update && sudo apt upgrade -y");
  assert.equal(recipe("upgrade", vm).cmd, "apk update && apk upgrade");
});

test("unknown requests are left to the model", () => {
  assert.equal(recipe("find files bigger than 100MB", vm), null);
  assert.equal(quickAnswer("count the lines in notes.txt", vm), null);
  assert.equal(quickAnswer("show me the files", docker), null);
});

test("typo fixes for commands and subcommands", () => {
  assert.equal(fixTypos("gti status"), "git status");
  assert.equal(fixTypos("git stauts"), "git status");
  assert.equal(fixTypos("gti psuh origin main"), "git push origin main");
  assert.equal(fixTypos("sudo apt-get instal curl"), "sudo apt-get install curl");
  assert.equal(fixTypos("lss -la"), "ls -la");
  assert.equal(fixTypos("brwe install fish"), "brew install fish");
  assert.equal(fixTypos("ls -la"), null, "nothing to fix");
  assert.equal(fixTypos("git -C dir status"), null, "flags aren't subcommands");
  assert.equal(fixTypos("xq"), null, "too short to guess");
  assert.equal(fixTypos("mytool --help", ["mytool"]), null, "known commands are left alone");
});

test("sentences skip the typo fixer", () => {
  assert.ok(looksLikeSentence("count the lines in notes.txt"));
  assert.ok(!looksLikeSentence("gti status"));
  assert.ok(!looksLikeSentence("git commit -m fix"));
});

test("model replies: tagged, bare, refusals and junk", () => {
  assert.deepEqual(parseReply("CMD: ls -lh\n"), { cmd: "ls -lh" });
  assert.deepEqual(parseReply("```\n$ df -h\n```"), { cmd: "df -h" });
  assert.deepEqual(parseReply("`du -sh .`"), { cmd: "du -sh ." });
  assert.deepEqual(parseReply("NO: Homebrew can't run here"), { no: "Homebrew can't run here" });
  assert.deepEqual(parseReply("CMD: du -sh /path/to/directory"), { cmd: "du -sh ." });
  assert.deepEqual(parseReply("grep -r TODO /path/to/folder/ | less"), { cmd: "grep -r TODO . | less" });
  assert.equal(parseReply(""), null);
  assert.equal(parseReply("\n\n"), null);
  assert.equal(parseReply("x".repeat(600)), null);
});

test("messages name the system and end with the request", () => {
  const m = messages("install python", vm, { shell: "zsh" });
  assert.equal(m[0].role, "system");
  assert.match(m[0].content, /Alpine.*apk|apk[\s\S]*Alpine/s);
  assert.match(m[0].content, /Shell: zsh/);
  assert.deepEqual(m.at(-1), { role: "user", content: "install python" });
  assert.ok(m.some(x => x.content === "CMD: apk add python3"));
  assert.ok(messages("install python", macos).some(x => x.content === "CMD: brew install python"));
});

test("danger warnings", () => {
  assert.deepEqual(dangers("ls -la"), []);
  assert.ok(dangers("sudo apt install htop").some(w => w.includes("sudo")));
  assert.ok(dangers("rm -rf build").some(w => w.includes("rm")));
  assert.ok(dangers("rm --recursive x").length);
  assert.ok(dangers("dd if=/dev/zero of=/dev/sda").length >= 1);
  assert.ok(dangers("mkfs.ext4 /dev/sdb1").length);
  assert.ok(dangers("curl -fsSL https://x.sh | sh").some(w => w.includes("internet")));
  assert.ok(dangers('/bin/bash -c "$(curl -fsSL https://x/install.sh)"').some(w => w.includes("internet")));
  assert.ok(dangers("echo hi > /dev/sda").length);
  assert.ok(dangers("chmod -R 777 /").length);
  assert.ok(dangers(":(){ :|:& };:").some(w => w.includes("fork")));
  assert.deepEqual(dangers("rm notes.txt"), [], "a plain rm of one file is normal");
});

test("hook payloads decode, junk doesn't", () => {
  assert.equal(parseHook(`assist;${b64("gti status")}`), "gti status");
  assert.equal(parseHook(`assist;${b64("gti status\n")}`), "gti status", "fish adds a newline");
  assert.equal(parseHook(`assist;${b64("café")}`), "café");
  assert.equal(parseHook("assist;"), null);
  assert.equal(parseHook("assist;!!!"), null);
  assert.equal(parseHook("ready;zsh"), null);
});

test("every extra has a package or script, and a known group", () => {
  for (const e of extras) {
    assert.ok(e.script || e.apk || e.apt || e.brew, e.name);
    assert.ok(e.url.startsWith("https://"), e.name);
    assert.ok(["Shell", "Files", "Search", "System", "Git", "Help", "Fun"].includes(e.group), e.name);
  }
});

test("the in-image extras and cheat commands match their lists (run node scripts/gen-shell.mjs)", () => {
  assert.equal(readFileSync(new URL("../image/shell/extras", import.meta.url), "utf8"), renderExtras());
  assert.equal(readFileSync(new URL("../image/shell/cheat", import.meta.url), "utf8"), renderCheat());
});
