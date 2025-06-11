**Project Codename: “Helios-OS”
Implementation Guide (v0.2 — Jun 2025)**

> Opinion-ated, fact-checked, concise. Everything a senior dev team needs to build the TypeScript-only hacking MMO.

For detailed guides on each component see the [docs directory](docs/README.md).

---

## 0 — Core Goals

1. **One language for players:** TypeScript for every script, daemon, UI or exploit.
2. **Hard sandbox:** V8 isolates, Rust host. No `vm2` (multiple CVEs). ([uptycs.com][1], [github.com][2])
3. **Lean desktop build:** Tauri 2 native WebView, not Electron (≈ 10× smaller & lighter). ([v2.tauri.app][3], [reddit.com][4])
4. **Deterministic snapshots:** Entire machine state = pure JSON; reload → identical ticks.
5. **MMO authority:** World router keeps truth; clients are deterministic replicas.

---

## 1 — High-Level Stack

| Layer           | Tech / Libs                                       | Notes                                                   |
| --------------- | ------------------------------------------------- | ------------------------------------------------------- |
| **Host shell**  | **Tauri 2** (Rust) + V8 isolates                  | Native window, thread pool, raw sockets.                |
| **Kernel**      | Pure TS state tree + async syscall bus            | Single source of truth, snapshot-able.                  |
| **Userland**    | React/Preact, **xterm.js**                        | Windows, terminal, editor. ([github.com][5])            |
| **Services**    | Pluggable TS daemons (HTTP, SSH…)                 | Register via `kernel.listen(port, handler)`.            |
| **MMO backend** | Rust + Cloudflare Workerd-style isolate host      | Same V8 sandbox model. ([developers.cloudflare.com][6]) |
| **Build chain** | esbuild + SWC (ts→js), wasm-bindgen for Rust→WASM | Compile in < 20 ms for 1 kLOC.                          |

---

## 2 — Directory Layout

```
helios/
├─ apps/
│  ├─ cli/          # Built-in CLI commands
│  │  └─ src/       # Source for bundled binaries
│  └─ examples/     # Sample demo programs
├─ core/
│  ├─ kernel.ts     # Syscall bus + scheduler
│  ├─ fs/           # In-mem FS impl
│  ├─ net/          # NIC, TCP/UDP, Wi-Fi
│  └─ services/     # Built-in daemons
├─ host/            # Rust sidecar (Tauri command)
├─ ui/              # React windows, xterm bindings
└─ tools/           # CLI for build/package/snapshot
```

---

## 3 — Kernel Essentials

### 3.1 State Model (excerpt)

```ts
type PID = number;

interface PCB {
  pid: PID;
  uid: number;
  quotaMs: number;          // Host-CPU budget per tick
  quotaMem: number;         // Bytes hard cap
  cpuMs: number;            // CPU time consumed
  memBytes: number;         // Memory usage so far
  tty?: string;             // Attached terminal device
  mailbox: Message[];
}

interface FSNode {
  path: string;
  kind: 'file'|'dir';
  perms: Perms;
  data?: Uint8Array;
}

interface NIC {
  id: string;
  mode: 'ethernet'|'wifi';
  mac: string;
  ip?: string;
  rx: Packet[];
  tx: Packet[];
}
```

*Store everything in a single immutable-updated object; snapshot = `JSON.stringify(root)`.*

#### Process accounting

Each `PCB` also records runtime stats:

- `cpuMs` and `memBytes` accumulate the CPU time and memory consumed by the isolate.
- `tty` stores the TTY device name when provided to `spawn()`.

The builtin `ps` command displays these metrics:

```
PID %CPU %MEM TTY COMMAND
1 40.0 20.0 tty0 /bin/bash
2  0.5  0.1 tty0 ping 127.0.0.1
3  0.0  0.1 ?   ps
```

### 3.2 Scheduler

```ts
while (true) {
  const p = readyQueue.pop();
  runIsolate(p, timesliceMs);
  if (!p.exited) readyQueue.push(p);
}
```

*Timeslice and quotas enforced by the Rust host (kill isolate on overrun).*

### 3.3 Syscall Bus

| Call                      | Description       |
| ------------------------- | ----------------- |
| `open(path, flags)`       | returns fd        |
| `read(fd, n)`             | Uint8Array        |
| `write(fd, bytes)`        | count             |
| `close(fd)`               | releases handle   |
| `spawn(code, opts)`       | new PID           |
| `listen(port, proto, cb)` | service daemon    |
| `connect(ip, port)`       | socket handle     |
| `tcp_send(sock, bytes)`   | TCP send          |
| `udp_send(sock, bytes)`   | UDP send          |
| `draw(htmlBlob, opts)`    | open GUI window   |
| `mkdir(path, perms)`      | create directory  |
| `readdir(path)`           | list directory    |
| `unlink(path)`            | remove file       |
| `rename(old, new)`        | move/rename file  |
| `mount(img, path)`        | attach disk image |
| `unmount(path)`           | detach disk image |
| `snapshot()`              | returns JSON blob |
| `save_snapshot()`         | persist snapshot  |
| `save_snapshot_named(name)` | persist to slot |
| `load_snapshot_named(name)` | load slot & reboot |

---

## 4 — File System

* UNIX-like paths, 4-byte permissions mask.
* Disk images = compressed chunks of the FS tree (saved every N minutes).
* `mount(img)` lets players swap USB sticks, ISO hacks, etc.

---

## 5 — Networking Fabric

| Layer            | Key Details                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Ethernet / Wi-Fi | Same `Frame` object; Wi-Fi adds `{rssi, channel}` fields.                                      |
| Switch           | CAM table (MAC→port) ageing 300 s. Floods unknown unicast.                                     |
| Router           | Static/MS-RIP tables; CLI `route add`. 32-bit TTL.                                             |
| Provider         | Owns CIDR block, charges tokens per GiB; exposes DHCP, NAT.                                    |
| MMO tunnel       | Frames beyond local provider → WebSocket to “world router”. Latency injected from JSON matrix. |

---

## 6 — Built-in Services (TS Daemons)

| Service            | API Stub                | Notes                                           |
| ------------------ | ----------------------- | ----------------------------------------------- |
| **HTTP/HTTPS**     | `import { startHttpd }` | Express-like callback; optional TLS fake cert.  |
| **SSH**            | `startSshd(opts)`       | XOR “cipher”, PTY ↔ kernel TTY.                 |
| **FTP / SFTP**     | `startFtpd(root)`       | Maps virtual FS, respects ACL.                  |
| **SMTP / IMAP**    | `startMailer(domain)`   | Messages = JSON blobs in `/var/mail`.           |
| **P2P Coin**       | `createChain(config)`   | Hash-cash PoW adjustable; gossip over UDP port. |
| **DNS**            | `startNamed(zonefile)`  | Authoritative & cache modes.                    |
| **APT / fake-npm** | `apt install foo`       | Tarball + `pkg.json`; integrity = SHA-256.      |

*All daemons declare caps in a manifest:*

```jsonc
{
  "name": "httpd",
  "caps": ["net:tcp", "fs:read:/var/www"]
}
```

Kernel denies undeclared syscalls.

---

## 7 — Security Model

| Threat         | Mitigation                                                      |
| -------------- | --------------------------------------------------------------- |
| Isolate escape | Native V8 isolate per process (Rust `v8` crate); **never** vm2. |
| Infinite loops | Host `tokio::time::timeout` kills runaway isolate.              |
| Over-RAM       | Pre-allocate ArrayBuffer limit; isolate crashes if exceeded.    |
| Host FS leak   | Tauri allow-list only exposes `/tmp/helios` for logs.           |
| MMO grief      | Authoritative server double-sandboxes isolates inside LXC.      |

---

## 8 — Persistence & Sync

* **Single-player:** snapshot on demand (`ctrl-s`) ⇒ gzip < 10 MB.
* **MMO:**

  * Server keeps per-machine block-diffs, per-ISP ledger, global DNS zone.
  * Delta sync every 3 s; SHA-1 epoch hash ensures determinism.
  * Rollback: operator replaces diff chain; clients auto-replay.
* `reboot` saves the current snapshot and reloads it on next boot so services
  and open windows persist.
* `snapshot save <name>` stores the state and `snapshot load <name>` restores it.
* Save slots are backed by the `save_snapshot_named` and `load_snapshot_named` syscalls.

---

## 9 — Developer Workflow

1. `pnpm i` – installs deps, including `@xterm/*` (new scoped pkgs). ([github.com][7])
2. `tsconfig.json` defines repo-wide TypeScript options (`target`/`module` set to `esnext`, `jsx` to `react`).
3. `pnpm dev` – launches Tauri. The unified build script runs in watch mode so the Vite dev server starts automatically.
4. `pnpm build:release` – cross-build Win/macOS/Linux/ARM using the same build script.
   On Linux this step requires the `glib-2.0` development package; otherwise bundling fails with a `glib-2.0.pc` lookup error.
5. `helios snap path/to/out.helios` – CLI packs snapshot for Steam Workshop.
6. **Modders:** drop TS file in `apps/`, run `makepkg`, publish to own apt repo.
7. `pnpm lint` checks code style; a `precommit` script automatically runs
   `pnpm lint && pnpm test` before each commit.

---

## 10 — Milestone Roadmap (16 weeks)

| Week  | Deliverable                         | Exit Test                       |
| ----- | ----------------------------------- | ------------------------------- |
| 1-2   | Kernel MVP: spawn, FS, `echo`.      | `cat /etc/issue` prints.        |
| 3-4   | Window mgr + xterm.js.              | Drag windows, resize terminal.  |
| 5-6   | TCP stack + ping loopback.          | `ping 127.0.0.1` < 10 ms.       |
| 7     | Switch + router; cross-subnet ping. | Ping across /24.                |
| 8     | HTTP daemon & browser app.          | Serve page inside VM.           |
| 9     | SSH mock login over LAN.            | Remote shell works.             |
| 10    | DNS + DHCP.                         | `curl http://foo.vm` resolves.  |
| 11    | apt repo + `apt install nano`.      | Editor launches.                |
| 12-13 | P2P coin ledger.                    | 3-node chain reaches consensus. |
| 14    | MMO world router alpha.             | Two clients share ping 80 ms.   |
| 15    | Snapshot / restore, Steam save.     | Reload identical checksum.      |
| 16    | Security fuzz & hardening.          | 48 h soak, no crash.            |

---

## 11 — Reference Links

* Tauri 2 docs & security model ([v2.tauri.app][8])
* GodotJS (optional renderer swap) ([github.com][9])
* Cloudflare isolate security model (MMO backend inspiration) ([developers.cloudflare.com][6])

---

### Final Word

Ship the lean Rust + V8 core **first**. Every protocol, exploit and neon-CRT shader is “just another TS daemon” once the syscall bus, isolate caps and snapshot machinery work. Stick to the milestones, keep the RAM budget honest, and the rest of the internet will write the malware for you. Happy building!

[1]: https://www.uptycs.com/blog/threat-research-report-team/exploitable-vm2-vulnerabilities?utm_source=chatgpt.com "CVE-2023-29017: Uncovering Potentially Exploitable vm2 ... - Uptycs"
[2]: https://github.com/patriksimek/vm2/issues/515?utm_source=chatgpt.com "[VM2 Sandbox Escape] Vulnerability in vm2@3.9.14 #515 - GitHub"
[3]: https://v2.tauri.app/blog/tauri-20/?utm_source=chatgpt.com "Tauri 2.0 Stable Release"
[4]: https://www.reddit.com/r/rust/comments/1fukj52/tauri_20_stable_has_just_been_released/?utm_source=chatgpt.com "Tauri 2.0 stable has just been released. : r/rust - Reddit"
[5]: https://github.com/xtermjs/xterm.js?utm_source=chatgpt.com "xtermjs/xterm.js: A terminal for the web - GitHub"
[6]: https://developers.cloudflare.com/workers/reference/security-model/?utm_source=chatgpt.com "Security model - Workers - Cloudflare Docs"
[7]: https://github.com/xtermjs/xterm.js/releases?utm_source=chatgpt.com "Releases · xtermjs/xterm.js - GitHub"
[8]: https://v2.tauri.app/?utm_source=chatgpt.com "Tauri 2.0 | Tauri"
[9]: https://github.com/godotjs/GodotJS?utm_source=chatgpt.com "godotjs/GodotJS: Add TypeScript/JavaScript Support for Godot 4.x ..."
