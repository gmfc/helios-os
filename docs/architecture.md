# Architecture Overview

Helios-OS is structured as a thin Rust host that launches isolated TypeScript programs. The system is split into several layers:

| Layer | Description |
| ----- | ----------- |
| **Host shell** | Rust service built with Tauri. It creates V8 isolates, enforces quotas and exposes native APIs. |
| **Kernel** | Pure TypeScript state tree. Provides files, networking, process scheduling and a syscall bus. |
| **Userland** | React based windows and terminal emulation via xterm.js. |
| **Services** | Daemons written in TypeScript that plug into the kernel via `listen()` calls. |
| **MMO backend** | Optional server side host that mirrors the same isolate model for multiplayer. |

Each subsystem lives in its own directory:

- `core/` – kernel, filesystem and networking implementations.
- `host/` – Rust sidecar that hosts the V8 isolates and provides Tauri bindings.
- `ui/` – front‑end windows and components.
- `apps/` – example applications shipped with the OS.
- `tools/` – command line utilities for building and packaging snapshots.

Snapshots contain the entire JSON state of a machine. The project aims for deterministic replay, so restoring a snapshot recreates the exact same runtime state.
