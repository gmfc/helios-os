# GUI, Shell and Sandbox Roadmap

This document outlines the next three pillars for Helios-OS. It summarizes how the window server, bash shell and GUI app sandbox integrate into the existing architecture.

## 1. Window server and desktop

- A React `<Desktop>` component acts as the window server.
- When a program calls `sys_draw`, the kernel emits a `desktop.createWindow` event with the window ID and initial HTML.
- The window server mounts an `<iframe sandbox>` for each window and handles Z-order, resizing and focus events.
- Window handles are represented in the file descriptor table as `{ kind: 'window', winId }`.
- Operations such as `write`, `read`, `ioctl` and `close` work on window FDs just like regular files.

## 2. Embedded bash shell

- The terminal becomes a TTY device backed by a master/slave pseudo-terminal pair.
- A minimal bash implementation runs inside Helios-OS and uses standard syscalls.
- Pipelines and redirection rely on a new `pipe()` syscall that returns a read/write FD pair.
- Child processes inherit the shell's FDs unless explicitly redirected.

## 3. Sandbox for GUI applications

- GUI apps live under `/usr/share/appname` with HTML, CSS and TypeScript assets.
- The helper module `lib/gui.d.ts` exposes `createWindow`, `onMessage` and `postMessage` APIs.
- Each iframe is isolated with `allow-scripts` and communicates via `postMessage` to avoid cross-window spoofing.

## 4. Window manager UX

- Default mode is floating windows with snap-to-edge behaviour.
- `Alt` + drag moves, `Alt` + right-drag resizes, and `Win` + arrows perform maximise and tiling actions.
- A global key listener in React dispatches these actions to the desktop store.

## 5. Boot sequence (summary)

1. Rust/Tauri host loads `index.html` and injects the kernel isolate.
2. Kernel mounts the filesystem and spawns `/sbin/init`.
3. `init` spawns `/bin/login`, which attaches to `/dev/tty0` and launches `/bin/bash`.
4. The user can run `startx` to create the initial window server and desktop.

## 6. Next milestones

| Milestone | Key deliverables                                |
| --------- | ----------------------------------------------- |
| 4         | Pre‑emptive scheduler and background jobs       |
| 5         | Network stack with sockets                      |
| 6         | APT client and GUI package federation           |
| 7         | Theme engine and shader-based compositor        |


