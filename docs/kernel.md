# Kernel Guide

The kernel is implemented entirely in TypeScript under `core/`. It maintains the machine state as an in-memory tree and exposes asynchronous syscalls to user programs.

## Key Components

- `fs/` – In-memory filesystem. Files are stored as nodes with Unix‑style permissions. Snapshots are persisted via a small SQLite database.
- `net/` – Simple network stack providing NICs, TCP and UDP sockets. Routers and switches are also written in TypeScript.
- `services/` – Built‑in daemons such as the HTTP and SSH servers.
- `eventBus.ts` – Lightweight event emitter used for UI messages and service events.
- `kernel.ts` – The main scheduler, process table and syscall implementations.

Processes are executed inside V8 isolates spawned by the host. Each process has quotas for CPU time and memory. Syscalls are dispatched through a message bus to the kernel.

### Snapshotting

`core/fs/sqlite.ts` provides helpers to load and persist the entire kernel state. A snapshot is pure JSON that captures files, running processes and network connections. Loading a snapshot recreates the same environment deterministically.

### Syscalls

User programs interact with the kernel through an asynchronous syscall dispatcher. The table below lists all calls currently supported.

| Call | Notes |
| ---- | ----- |
| `open(path, flags)` | open a file and return an fd |
| `read(fd, n)` | read bytes from an fd |
| `write(fd, bytes)` | write bytes to an fd |
| `close(fd)` | close a file descriptor |
| `spawn(code, opts)` | start a new process |
| `listen(port, proto, cb)` | register a network service |
| `connect(ip, port)` | obtain a socket handle |
| `tcp_send(sock, bytes)` | send data over TCP |
| `udp_send(sock, bytes)` | send data over UDP |
| `draw(html, opts)` | open a GUI window |
| `mkdir(path, perms)` | create a directory |
| `readdir(path)` | list directory entries |
| `unlink(path)` | remove a file or empty dir |
| `rename(old, new)` | move or rename a node |
| `mount(img, path)` | mount a disk image |
| `unmount(path)` | unmount a disk image |
| `snapshot()` | return the full machine state |
| `save_snapshot()` | persist state to disk |
| `save_snapshot_named(name)` | persist to named slot |
| `load_snapshot_named(name)` | load slot & reboot |

### Reboot and restore

The `/sbin/reboot` command calls `kernel.reboot()`. This persists the current
snapshot via `save_snapshot()` and stops the scheduler. On the next boot
`Kernel.create()` loads that snapshot, recreating services and open windows so
the desktop resumes exactly where it left off. Calling
`load_snapshot_named(name)` loads the requested snapshot, saves it as the active
one and reboots automatically so the restored state becomes live.
