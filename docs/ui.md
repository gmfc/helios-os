# User Interface

The front‑end lives under `ui/` and is built with React. It provides windows, terminals and other components used by applications.

## Structure

- `index.html` – Entry HTML loaded by Tauri.
- `index.tsx` – Bootstraps React and connects to the kernel event bus.
- `components/` – Contains the window manager, draggable windows and xterm.js bindings.

Each window corresponds to a kernel `draw` syscall. When a process requests a UI window, the host sends an event to the browser context and React renders the provided HTML blob inside a new `Window` component.
