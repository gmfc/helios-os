# Kernel MVP Walkthrough

This document outlines the initial kernel used in Helios-OS. It mirrors the implementation-level steps provided during project planning and serves as a reference for new contributors.

## Scope of the MVP

The first milestone focuses on a minimal but functional system:

- Boot sequence and a single global state tree
- Cooperative scheduler with a simple process table
- In-memory virtual file system supporting read and write operations
- Asynchronous syscall dispatcher
- Process spawning and teardown
- Standard IO handling for terminal windows

Features such as networking, GUI drawing, timers and persistence are deferred to later milestones.

The expected test run is:

```
$ echo "Hello, Kernel" > /tmp/msg
$ cat /etc/issue
Welcome to Helios-OS v0.1
$ cat /tmp/msg
Hello, Kernel
```

Running the above sequence in one terminal verifies that the kernel, filesystem and basic syscalls work together correctly.

## Directory Layout

```
helios/
├─ host/                 # Rust (tauri) launcher
│   └─ lib.rs            # exposes JS <-> Rust FFI
├─ core/
│   ├─ kernel.ts         # entry point
│   ├─ scheduler.ts
│   ├─ syscalls.ts
│   ├─ fs/
│   │   ├─ node.ts       # data model
│   │   └─ vfs.ts        # filesystem ops
│   └─ process/
│       ├─ pcb.ts
│       └─ fdtable.ts
├─ apps/                 # userland programs
│   ├─ cli/programs/     # CLI utilities compiled into /bin
│   └─ examples/         # sample GUI apps
└─ ui/                   # React + xterm.js
```

Core and apps are bundled with esbuild into a single JavaScript file that the host loads inside one V8 isolate.
Built-in CLI programs are gathered by `tools/build-apps.ts` which writes `core/fs/generatedApps.ts`.

## Kernel State

The kernel stores all mutable data in a single object updated immutably. A simplified version is shown below:

```ts
interface KernelState {
    nextPid: number;
    processes: Record<number, PCB>;
    fs: FileSystem;
}
```

All APIs return a new state object instead of mutating in place. Libraries such as `immer` or small helpers can keep calling code clean while ensuring that the state remains immutable.

## Process Abstraction

Each process is represented by a PCB (process control block):

```ts
interface PCB {
    pid: number;
    ppid: number;
    uid: number;
    cwd: string;
    fds: FDTable;
    exitCode?: number;
    awaiting?: Promise<void>; // for cooperative scheduling
}
```

File descriptors are managed through a simple map. Descriptors `0`, `1` and `2` are reserved for standard input, output and error.

## Virtual File System

Nodes consist of files and directories with Unix‑style metadata. VFS operations are pure functions that return updated filesystem snapshots.

```ts
function fsLookup(fs: FileSystem, path: string): FSNode | undefined;
function fsCreateFile(fs: FileSystem, path: string, perms?: number): FileSystem;
function fsRead(fs: FileSystem, node: FileNode, off: number, len: number): {
    bytes: Uint8Array;
    newFs: FileSystem;
};
function fsWrite(
    fs: FileSystem,
    node: FileNode,
    off: number,
    data: Uint8Array
): FileSystem;
```

`bootstrapFileSystem()` populates `/etc/issue` so that `cat /etc/issue` prints "Welcome to Helios-OS v0.1".

## Syscall Dispatcher

User programs call into the kernel using a dispatcher bound to their PID:

```ts
const syscall = makeDispatcher(kernel, pid);
await syscall('write', 1, data);
```

The kernel exposes syscalls for opening, reading, writing and closing files. Each call returns a promise so programs can await asynchronous operations.

## Kernel Class Overview

`Kernel` owns the current `KernelState` and a registry of programs. `spawn()` creates a PCB, binds the dispatcher and executes the program. After completion, `finishProcess()` cleans up the PCB and resources.

## Built-in Programs

Two small programs are bundled for the MVP:

- **echo** – writes its arguments back to stdout
- **cat** – prints the contents of files

Registering these programs allows the earlier test sequence to work.

## Terminal Integration

The UI component sends entered lines to `kernel.spawn()` and prints output when the kernel writes to the terminal devices. After each command finishes, the UI prompts the user again.

## Testing Checklist

1. Boot: Tauri launches, React mounts and `/etc/issue` exists.
2. echo: `echo HELIOS` prints `HELIOS`.
3. cat existing file: `cat /etc/issue` prints the welcome line.
4. cat fail path: `cat /bogus` writes an error to stderr.
5. write & read: `echo hi > /tmp/foo` then `cat /tmp/foo` prints `hi`.
6. Process cleanup: repeated `echo` does not leak PIDs or FDs.

A Vitest suite can automate these checks by invoking kernel APIs directly.

## Next Steps

Once the MVP is stable the next milestones introduce a scheduler loop, isolated processes per V8 context, pipe support and persistent snapshots.
