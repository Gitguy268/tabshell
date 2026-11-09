// Local server for TabShell: serves dist/ and manages the Docker-mode container, on Docker or apple/container.
// Standard library only. Listens on 127.0.0.1, so nothing on the network can reach it.
import { createServer } from "node:http";
import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 8686;
const TTYD_PORT = 8687;
const NAME = "tabshell-linux";
const IMAGE = "tabshell-ubuntu";
const ROOT = fileURLToPath(new URL("./dist/", import.meta.url));
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon" };

const exec = (bin, args, timeout = 60_000) => new Promise((resolve, reject) =>
  execFile(bin, args, { timeout }, (err, stdout, stderr) => err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim())));

// Docker when it answers, otherwise apple/container. Re-checked until one is found, so starting either later works.
let runtime = null;
async function pick() {
  if (runtime) return runtime;
  if (await exec("docker", ["info", "-f", "{{.ServerVersion}}"], 5_000).then(() => true, () => false)) return runtime = "docker";
  if (await exec("container", ["system", "status"], 5_000).then(() => true, () => false)) return runtime = "container";
  return null;
}
const rt = async (...args) => exec(await pick() ?? "docker", args);

// container inspect gives JSON; ttyd is reached on the container's own address, since its port forwarding
// isn't reliable on every Mac.
export function parseContainerInspect(out) {
  const c = JSON.parse(out)[0];
  if (!c) return null;
  const env = c.configuration?.initProcess?.environment ?? [];
  return { running: c.status?.state === "running", token: env.find(e => e.startsWith("TOKEN="))?.slice(6),
    host: c.status?.networks?.[0]?.ipv4Address?.split("/")[0], port: 7681 };
}

async function inspect() {
  try {
    if (await pick() === "container") return parseContainerInspect(await rt("inspect", NAME));
    const [running, ...env] = (await rt("inspect", "-f", "{{.State.Running}}{{range .Config.Env}}\n{{.}}{{end}}", NAME)).split("\n");
    return { running: running === "true", token: env.find(e => e.startsWith("TOKEN="))?.slice(6), host: "127.0.0.1", port: TTYD_PORT };
  } catch { return null; }
}

async function create() {
  const token = randomBytes(24).toString("hex");
  // No volumes or bind mounts: removing the container removes everything the user did.
  // Privileged so podman (the `container` command inside) can run containers; each apple/container is its own VM.
  await (await pick() === "container"
    ? rt("run", "-d", "--name", NAME, "--cap-add", "ALL", "-e", `TOKEN=${token}`, IMAGE)
    : rt("run", "-d", "--name", NAME, "--hostname", "tabshell", "--privileged", "-p", `127.0.0.1:${TTYD_PORT}:7681`, "-e", `TOKEN=${token}`, IMAGE));
  return token;
}

// Starts the existing container, or creates one; the container lives until Reset. Resolves to its token and ttyd address.
let pending = null;
function ensure() {
  return pending ??= (async () => {
    let c = await inspect();
    if (c?.running) return c;
    if (c) await rt("start", NAME); else await create();
    c = await inspect();  // a started apple/container may get a new address
    await ttydReady(c);
    return c;
  })().finally(() => { pending = null; });
}

// Docker's port forward accepts connections before ttyd listens, so wait for an HTTP answer (401 is fine).
async function ttydReady({ host, port }) {
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://${host}:${port}/`).then(() => true, () => false)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("ttyd did not start in the container");
}

async function reset() {
  // A start still in progress would hand back the container that's about to be removed.
  await pending?.catch(() => {});
  await rt(await pick() === "container" ? "delete" : "rm", "--force", NAME).catch(() => {});
  return ensure();
}

async function status() {
  const runtime = await pick();
  if (!runtime) return { docker: false };
  const image = await rt("image", "inspect", IMAGE).then(() => true, () => false);
  return { docker: true, runtime, image, container: await inspect() !== null };
}

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

export const server = createServer(async (req, res) => {
  // Blocks DNS rebinding: a page on evil.example resolving to 127.0.0.1 still sends Host: evil.example.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return json(res, 403, { error: "bad host" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      // Cross-site pages can send a POST but not read the response, so state changes need our Origin.
      if (req.method !== "GET" && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: "bad origin" });
      if (url.pathname === "/api/status" && req.method === "GET") return json(res, 200, await status());
      // ttyd also wants the token in its first message. No CORS headers, so only our own page can read it.
      if (url.pathname === "/api/token" && req.method === "GET") return json(res, 200, { token: Buffer.from(`dev:${(await ensure()).token}`).toString("base64"), runtime });
      if (url.pathname === "/api/reset" && req.method === "POST") { await reset(); return json(res, 200, { ok: true }); }
      return json(res, 404, { error: "not found" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method" });
    let decoded;
    try { decoded = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname); } catch { return json(res, 400, { error: "bad path" }); }
    const path = normalize(join(ROOT, decoded));
    if (!path.startsWith(ROOT)) return json(res, 403, { error: "bad path" });
    const body = await readFile(path).catch(() => null);
    if (!body) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

// WebSocket proxy to ttyd. Browsers can't set the Basic-auth header ttyd needs, so it's added here,
// and only for pages served by this server: WebSockets skip CORS, so the Origin check is what stops other sites.
server.on("upgrade", async (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  if (req.url !== "/ws" || !ALLOWED_HOSTS.has(req.headers.host) || req.headers.origin !== `http://${req.headers.host}`) {
    return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  }
  let token, host, port;
  try { ({ token, host, port } = await ensure()); } catch { return socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n"); }
  const upstream = connect(port, host, () => {
    const headers = { ...req.headers, host: `${host}:${port}`, authorization: `Basic ${Buffer.from(`dev:${token}`).toString("base64")}` };
    delete headers.origin;
    upstream.write(`GET /ws HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("close", () => upstream.destroy());
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, "127.0.0.1", () => console.log(`TabShell running at http://localhost:${PORT}`));
}
