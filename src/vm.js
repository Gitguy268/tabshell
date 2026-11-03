// Browser VM backend: Alpine Linux (i386) in v86, wired to xterm.js through the virtio console.
import { V86 } from "v86";
import wasmUrl from "v86/build/v86.wasm?url";

export const DEFAULT_RELAY = "wisps://wisp.mercurywork.shop/v86/";
const BASE = import.meta.env.BASE_URL;
const DB = "tabshell";
const KEY = "vm-state";
const SAVE_WHEN_QUIET_MS = 5_000;
const SAVE_EVERY_MS = 60_000; // for nonstop output, such as a game
const RUNNING = "Alpine Linux · 32-bit · in your browser";

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
// A state from an older image would point at files that no longer exist, so it's only used on the same image.
const loadState = () => idb("readonly", s => s.get(KEY)).catch(() => undefined);
const storeState = buf => idb("readwrite", s => s.put({ image: __IMAGE_ID__, buf }, KEY));
const clearState = () => idb("readwrite", s => s.delete(KEY));

export function startVm(term, { relay, onStatus }) {
  let emulator, dirty = false, saving = null, stopped = false, timer, quiet, input = new Uint8Array(0), flushing = false;
  // Only one tab saves the VM: two would each keep overwriting the other's work. The lock is released on stop or reset.
  // A tab that starts second waits in line and takes over saving when the first one closes.
  let owner = false, release;
  const locked = new Promise(r => { release = r; });
  const hold = lock => { if (lock) owner = true; return lock && locked; };
  const ownership = !navigator.locks ? Promise.resolve(owner = true)
    : new Promise(decided => navigator.locks.request("tabshell-vm", { ifAvailable: true }, lock => { const held = hold(lock); decided(); return held; })
      .catch(() => { owner = true; decided(); }))
      .then(() => {
        if (owner || stopped) return;
        navigator.locks.request("tabshell-vm", lock => {
          if (stopped) return;
          hold(lock);
          touch(); // saves this tab's VM soon, now that it's the one kept
          if (emulator) onStatus(RUNNING);
          return locked;
        }).catch(() => {});
      });
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  // v86 (0.5.463 to 0.5.472) writes this pair into the Linux resize message in reverse, so rows go first to arrive as cols×rows.
  const resize = () => emulator?.bus.send("virtio-console0-resize", [term.rows, term.cols]);

  // v86 drops console input when the guest has no receive buffer posted, which loses fast typing and pastes.
  // So input waits in a queue until the receive queue has room.
  // shortcut: reads v86 internals (v86.cpu.devices.virtio_console), recheck when upgrading v86.
  const touch = () => { dirty = true; clearTimeout(quiet); quiet = setTimeout(save, SAVE_WHEN_QUIET_MS); };
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
    touch();
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    const merged = new Uint8Array(input.length + bytes.length);
    merged.set(input);
    merged.set(bytes, input.length);
    input = merged;
    if (!flushing) flush();
  }

  async function save() {
    if (!emulator || !dirty || saving || stopped || !owner) return saving;
    dirty = false;
    saving = emulator.save_state().then(storeState).catch(err => { dirty = true; console.warn("TabShell: saving VM failed", err); })
      .finally(() => { saving = null; });
    return saving;
  }
  const onHidden = () => document.visibilityState === "hidden" && save();

  async function boot() {
    await ownership;
    if (stopped) return;
    const stored = await loadState();
    const saved = stored?.image === __IMAGE_ID__ ? stored.buf : undefined;
    if (stopped) return;
    onStatus(saved ? "Restoring your VM…" : stored
      ? "TabShell's Linux image was updated, so this is a fresh VM. Booting… (about 30 seconds)"
      : "Booting Alpine Linux… (first boot takes about 30 seconds)");
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

    const running = () => owner ? RUNNING : "TabShell is open in another tab, which keeps the saved VM. Changes in this tab are not saved.";
    let ready = false;
    emulator.add_listener("virtio-console0-output-bytes", bytes => {
      touch();
      term.write(dec.decode(bytes, { stream: true }));
      if (!ready) { ready = true; onStatus(running()); resize(); }
    });
    if (saved) {
      emulator.add_listener("emulator-started", () => {
        onStatus(running());
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
      clearTimeout(quiet);
      document.removeEventListener("visibilitychange", onHidden);
      try {
        await save();
        stopped = true;
        await emulator?.destroy();
      } finally { stopped = true; release(); }
    },
    async reset() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(quiet);
      document.removeEventListener("visibilitychange", onHidden);
      try {
        await ownership;
        await saving;
        await emulator?.destroy();
        // Another tab still runs the saved VM and would save it back, so only the owner wipes it.
        if (!owner) throw new Error("close TabShell in your other tabs first");
        await clearState();
      } finally { release(); }
    },
  };
}
