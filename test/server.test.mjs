import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";

process.env.PORT = "18686";
const { server, parseContainerInspect } = await import("../server.mjs");
before(() => new Promise(r => server.listen(18686, "127.0.0.1", r)));
after(() => server.close());

const call = (path, { method = "GET", headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port: 18686, path, method, headers: { host: "127.0.0.1:18686", ...headers } }, res => {
    let body = "";
    res.on("data", d => body += d).on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on("error", reject).end();
});

test("rejects other Host headers (DNS rebinding)", async () => {
  assert.equal((await call("/api/status", { headers: { host: "evil.example:18686" } })).status, 403);
});

test("rejects cross-origin reset", async () => {
  assert.equal((await call("/api/reset", { method: "POST", headers: { origin: "http://evil.example" } })).status, 403);
  assert.equal((await call("/api/reset", { method: "POST" })).status, 403);
});

test("sends no CORS headers", async () => {
  const res = await call("/api/status", { headers: { origin: "http://evil.example" } });
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("blocks path traversal", async () => {
  assert.notEqual((await call("/..%2Fserver.mjs")).status, 200);
  assert.notEqual((await call("/%2e%2e/package.json")).status, 200);
});

test("refuses WebSocket upgrades from other origins", async () => {
  const res = await new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: 18686, path: "/ws", headers: {
      host: "127.0.0.1:18686", origin: "http://evil.example", connection: "Upgrade", upgrade: "websocket",
      "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } });
    req.on("response", resolve).on("upgrade", () => reject(new Error("upgraded"))).on("error", reject).end();
  });
  assert.equal(res.statusCode, 403);
});

test("reads token and address from container inspect", () => {
  const out = JSON.stringify([{ configuration: { initProcess: { environment: ["PATH=/bin", "TOKEN=abc"] } },
    status: { state: "running", networks: [{ ipv4Address: "192.168.64.5/24" }] } }]);
  assert.deepEqual(parseContainerInspect(out), { running: true, token: "abc", host: "192.168.64.5", port: 7681 });
  assert.equal(parseContainerInspect("[]"), null);
});
