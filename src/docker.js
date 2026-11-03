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
  let ws, dec, stopped = false, ended = false;
  let early = []; // keys typed while connecting, sent once the shell is there

  async function connect() {
    ended = false;
    onStatus("Starting the Ubuntu container…");
    let token, runtime;
    try {
      const res = await fetch("/api/token", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      ({ token, runtime } = body);
      if (!res.ok || !token) throw new Error(body.error || res.statusText);
    } catch (err) {
      if (!stopped) end(`Couldn't start the container (${err.message}). Is Docker Desktop or container running?`);
      return;
    }
    if (stopped) return;
    dec = new TextDecoder();
    ws = new WebSocket(`ws://${location.host}/ws`, ["tty"]);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(enc.encode(JSON.stringify({ AuthToken: token, columns: term.cols, rows: term.rows })));
      for (const data of early) sendFrame("0", data);
      early = [];
      onStatus(`Ubuntu 26.04 · 64-bit · ${runtime === "container" ? "container" : "Docker"}`);
    };
    ws.onmessage = e => {
      const data = new Uint8Array(e.data);
      if (data[0] === 0x30) term.write(dec.decode(data.subarray(1), { stream: true }));
    };
    ws.onclose = () => { if (!stopped) end("Session ended"); };
  }

  function end(message) {
    ended = true;
    early = [];
    onStatus(message);
    term.write(`\r\n\x1b[2m[${message}. Press any key to start a new shell.]\x1b[0m\r\n`);
  }

  // A frame is one type byte ("0" input, "1" resize) followed by the payload.
  function sendFrame(type, payload) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    const bytes = typeof payload === "string" ? enc.encode(payload) : payload;
    const frame = new Uint8Array(bytes.length + 1);
    frame[0] = type.charCodeAt(0);
    frame.set(bytes, 1);
    ws.send(frame);
  }

  connect();

  return {
    send: data => {
      if (ended) connect();
      else if (ws?.readyState === WebSocket.OPEN) sendFrame("0", data);
      else early.push(data);
    },
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
