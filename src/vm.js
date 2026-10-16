// Browser VM backend: Alpine Linux (i386) in v86, wired to xterm.js through the virtio console.
import { V86 } from "v86";
import wasmUrl from "v86/build/v86.wasm?url";

export const DEFAULT_RELAY = "wisps://wisp.mercurywork.shop/v86/";
const BASE = import.meta.env.BASE_URL;
const DB = "tabshell";
const KEY = "vm-state";
const SAVE_EVERY_MS = 60_000;

const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => open.result.createObjectStore("state");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction("state", mode);
    const req = fn(tx.objectStore("state"));
    tx.oncomplete = () => { open.result.close(); resolve(req.result); };
    tx.onerror = tx.onabort = () => { open.result.close(); reject(tx.error); };
  };
});
const loadState = () => idb("readonly", s => s.get(KEY)).catch(() => undefined);
const storeState = buf => idb("readwrite", s => s.put(buf, KEY));
const clearState = () => idb("readwrite", s => s.delete(KEY));

export function startVm(term, { relay, onStatus }) {
  let emulator, dirty = false, saving = null, stopped = false, timer, input = new Uint8Array(0), flushing = false;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  // v86 0.5.463 writes this pair into the Linux resize message in reverse, so rows go first to arrive as cols×rows.
  const resize = () => emulator?.bus.send("virtio-console0-resize", [term.rows, term.cols]);

  // v86 drops console input when the guest has no receive buffer posted, which loses fast typing and pastes.
  // So input waits in a queue until the receive queue has room.
  // shortcut: reads v86 internals (v86.cpu.devices.virtio_console), recheck when upgrading v86.
  const rxReady = () => emulator?.v86?.cpu?.devices?.virtio_console?.virtio?.queues[0]?.has_request() ?? true;
  function flush() {
    flushing = false;
    while (input.length && emulator && rxReady()) {
      emulator.bus.send("virtio-console0-input-bytes", input.subarray(0, 512));
      input = input.subarray(512);
    }
    if (input.length && !stopped) { flushing = true; setTimeout(flush, 5); }
  }
  function send(data) {
    dirty = true;
    const bytes = enc.encode(data);
    const merged = new Uint8Array(input.length + bytes.length);
    merged.set(input);
    merged.set(bytes, input.length);
    input = merged;
    if (!flushing) flush();
  }

  async function save() {
    if (!emulator || !dirty || saving || stopped) return saving;
    dirty = false;
    saving = emulator.save_state().then(storeState).catch(err => { dirty = true; console.warn("TabShell: saving VM failed", err); })
      .finally(() => { saving = null; });
    return saving;
  }
  const onHidden = () => document.visibilityState === "hidden" && save();

  async function boot() {
    const saved = await loadState();
    if (stopped) return;
    onStatus(saved ? "Restoring your VM…" : "Booting Alpine Linux… (first boot takes about 30 seconds)");
    emulator = new V86({
      wasm_path: wasmUrl,
      bios: { url: BASE + "bios/seabios.bin" },
      vga_bios: { url: BASE + "bios/vgabios.bin" },
      memory_size: 512 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      bzimage_initrd_from_filesystem: true,
      cmdline: "rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose modules=virtio_pci tsc=reliable console=hvc0",
      filesystem: { baseurl: BASE + "alpine/flat/", basefs: BASE + "alpine/fs.json" },
      initial_state: saved ? { buffer: saved } : undefined,
      virtio_console: true,
      net_device: { type: "virtio", relay_url: relay || DEFAULT_RELAY },
      disable_keyboard: true,
      disable_mouse: true,
      autostart: true,
    });

    let ready = false;
    emulator.add_listener("virtio-console0-output-bytes", bytes => {
      dirty = true;
      term.write(dec.decode(bytes, { stream: true }));
      if (!ready) { ready = true; onStatus("Alpine Linux · 32-bit · in your browser"); resize(); }
    });
    if (saved) {
      emulator.add_listener("emulator-started", () => {
        onStatus("Alpine Linux · 32-bit · in your browser");
        resize();
        // Ctrl+L makes the shell redraw its prompt in the empty terminal.
        send("\x0c");
      });
    }
    timer = setInterval(save, SAVE_EVERY_MS);
    document.addEventListener("visibilitychange", onHidden);
  }

  boot().catch(err => onStatus("Couldn't start the VM: " + err.message));

  return {
    send,
    resize,
    // Saves first so switching to Docker mode and back keeps the VM as it was.
    async stop() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      await save();
      stopped = true;
      await emulator?.destroy();
    },
    async reset() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      await saving;
      await emulator?.destroy();
      await clearState();
    },
  };
}
