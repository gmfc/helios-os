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
