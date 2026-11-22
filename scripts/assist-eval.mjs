#!/usr/bin/env node
// Scores candidate GGUF models for the command assistant on fixed cases, with llama.cpp's llama-server.
//   node scripts/assist-eval.mjs model-a.gguf [model-b.gguf ...]
// Needs llama-server on PATH (brew install llama.cpp). Each case is scored twice: the model alone, and
// the full pipeline the app uses (recipes and typo fixes first, then the model).
import { spawn } from "node:child_process";
import { basename } from "node:path";
import { systems, messages, parseReply, quickAnswer } from "../src/assist-core.js";

const NO = "NO";
const brewInstaller = /Homebrew\/install/;
const cases = [
  ["vm", "install python", /^apk add python3?$/],
  ["vm", "install brew", NO],
  ["vm", "instal git", /^apk add git$/],
  ["vm", "show disk space", /^df\b/],
  ["vm", "what is my ip address", /^(ip (-\d )?(a|addr)|ifconfig|hostname -i)/],
  ["vm", "make a folder called projects", /^mkdir (-p )?projects$/],
  ["vm", "gti status", /^git status$/],
  ["vm", "lss -la", /^ls -la$/],
  ["vm", "find files bigger than 100MB", /^find .*-size \+100M/],
  ["vm", "count the lines in notes.txt", /^(wc -l <?\s*notes\.txt|cat notes\.txt \| wc -l)$/],
  ["vm", "delete the folder build", /^rm -(r|rf|fr) build\/?$/],
  ["vm", "show running processes", /^(ps|top|htop)\b/],
  ["vm", "update all packages", /^apk (update|upgrade)/],
  ["vm", "extract archive.tar.gz", /^tar .*archive\.tar\.gz$/],
  ["vm", "install nodejs", /^apk add nodejs/],
  ["docker", "install python", /^sudo apt(-get)? install( -y)? python3?$/],
  ["docker", "install brew", brewInstaller],
  ["docker", "instal htop", /^sudo apt(-get)? install( -y)? htop$/],
  ["docker", "sudo apt-get instal curl", /^sudo apt(-get)? install( -y)? curl$/],
  ["docker", "show disk usage of this folder", /^du -/],
  ["docker", "git psuh", /^git push/],
  ["docker", "clone https://github.com/Gitguy268/tabshell", /^git clone https:\/\/github\.com\/Gitguy268\/tabshell(\.git)?$/],
  ["docker", "which version of ubuntu is this", /(lsb_release|\/etc\/os-release|hostnamectl)/],
  ["docker", "download https://example.com/file.zip", /^(wget|curl)\b.*https:\/\/example\.com\/file\.zip/],
  ["docker", "kill the process on port 3000", /(lsof|fuser|kill).*3000/],
  ["docker", "show the last 20 lines of log.txt", /^tail -(n ?)?20 log\.txt$/],
  ["docker", "search for TODO in all files", /^(grep -[a-zA-Z]*r[a-zA-Z]* .*TODO|rg .*TODO)/],
  ["docker", "make script.sh executable", /^chmod (\+x|u\+x|755) script\.sh$/],
  ["docker", "pyhton3 --version", /^python3 --version$/],
  ["docker", "list the containers", /^(sudo )?(docker|podman|container) (ps|ls|list)/],
  ["macos", "install brew", brewInstaller],
  ["macos", "install wget", /^brew install wget$/],
  ["macos", "instal ripgrep", /^brew install ripgrep$/],
  ["macos", "brwe install fish", /^brew install fish$/],
  ["macos", "show hidden files", /^ls -[a-zA-Z]*a/],
  ["macos", "open this folder in finder", /^open \.$/],
  ["macos", "copy file.txt to the clipboard", /(pbcopy\s*<\s*file\.txt|cat file\.txt \| pbcopy)$/],
  ["macos", "what is using my cpu", /^(top|htop|ps)\b/],
  ["macos", "flush the dns cache", /(dscacheutil -flushcache|killall -HUP mDNSResponder)/],
  ["macos", "show my ip address", /(ipconfig getifaddr|ifconfig|curl .*(ifconfig|ipinfo|icanhazip))/],
  ["macos", "git comit -m 'fix'", /^git commit -m ['"]fix['"]$/],
  ["macos", "update everything", /^brew update/],
];

const shellOf = { vm: "sh", docker: "bash", macos: "zsh" };
const pass = (answer, want) => (want === NO ? !!answer?.no : !!answer?.cmd && want.test(answer.cmd));

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("llama-server didn't start");
}

async function evalModel(path, port) {
  const server = spawn("llama-server", ["-m", path, "--port", String(port), "-c", "2048", "-ngl", "0", "--no-webui"], { stdio: "ignore" });
  try {
    await waitFor(`http://127.0.0.1:${port}/health`, 60000);
    let model = 0, pipeline = 0, ms = 0;
    const rows = [];
    for (const [sysId, input, want] of cases) {
      const sys = systems[sysId];
      const t = Date.now();
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: messages(input, sys, { shell: shellOf[sysId] }), temperature: 0, max_tokens: 80 }),
      }).then(r => r.json());
      ms += Date.now() - t;
      const text = res.choices?.[0]?.message?.content ?? "";
      const answer = parseReply(text);
      const full = quickAnswer(input, sys) ?? answer;
      const okModel = pass(answer, want), okFull = pass(full, want);
      model += okModel;
      pipeline += okFull;
      rows.push(`${okModel ? "✓" : "✗"}${okFull ? "✓" : "✗"} [${sysId}] ${input}  →  ${text.split("\n")[0].slice(0, 110)}`);
    }
    return { name: basename(path), model, pipeline, avgMs: Math.round(ms / cases.length), rows };
  } finally {
    server.kill();
  }
}

const models = process.argv.slice(2);
if (!models.length) {
  console.error("usage: node scripts/assist-eval.mjs model.gguf [...]");
  process.exit(2);
}
const results = [];
for (const [i, m] of models.entries()) {
  const r = await evalModel(m, 8711 + i);
  console.log(`\n## ${r.name}\n${r.rows.join("\n")}`);
  results.push(r);
}
console.log(`\n| Model | Model alone | With recipes + typo fixes | Avg ms (CPU) |\n|---|---|---|---|`);
for (const r of results) console.log(`| ${r.name} | ${r.model}/${cases.length} | ${r.pipeline}/${cases.length} | ${r.avgMs} |`);
