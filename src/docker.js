// Docker backend: Ubuntu in a container on this computer, reached through server.mjs and ttyd.
// ttyd protocol: client sends a JSON hello, then "0"+input or "1"+{columns,rows}; server sends "0"+output.

export async function dockerAvailable() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export function startDocker(term, { onStatus }) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let ws, stopped = false, ended = false;

  async function connect() {
    ended = false;
    onStatus("Starting the Ubuntu container…");
    let token, runtime;
    try {
      const res = await fetch("/api/token", { cache: "no-store" });
      ({ token, runtime } = await res.json());
      if (!res.ok || !token) throw new Error("server said no");
    } catch {
      return end("Couldn't start the container. Is Docker Desktop or container running?");
    }
    if (stopped) return;
    ws = new WebSocket(`ws://${location.host}/ws`, ["tty"]);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(enc.encode(JSON.stringify({ AuthToken: token, columns: term.cols, rows: term.rows })));
      onStatus(`Ubuntu 24.04 · 64-bit · ${runtime === "container" ? "container" : "Docker"}`);
    };
    ws.onmessage = e => {
      const data = new Uint8Array(e.data);
      if (data[0] === 0x30) term.write(dec.decode(data.subarray(1), { stream: true }));
    };
    ws.onclose = () => { if (!stopped) end("Session ended"); };
  }

  function end(message) {
    ended = true;
    onStatus(message);
    term.write(`\r\n\x1b[2m[${message}. Press any key to start a new shell.]\x1b[0m\r\n`);
  }

  const sendFrame = (type, payload) => ws?.readyState === WebSocket.OPEN && ws.send(enc.encode(type + payload));

  connect();

  return {
    send: data => ended ? connect() : sendFrame("0", data),
    resize: () => sendFrame("1", JSON.stringify({ columns: term.cols, rows: term.rows })),
    async stop() { stopped = true; ws?.close(); },
    async reset() {
      stopped = true;
      ws?.close();
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    },
  };
}
