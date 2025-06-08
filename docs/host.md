# Host Service

The `host/` directory contains the Rust sidecar that embeds the V8 engine and integrates with Tauri. It is responsible for running isolated processes and enforcing resource limits.

## Responsibilities

- Create a new V8 isolate for each process spawned by the kernel.
- Invoke TypeScript code through the `run_isolate` command exposed via Tauri.
- Persist snapshots on shutdown and restore them on startup through SQLite.
- Provide a small database API used by the kernel for state storage (`db.rs`).

The host communicates with the TypeScript kernel using Tauri events. Each syscall from a process triggers an event that the kernel listens to and replies with a result.
