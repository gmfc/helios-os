# Helios-OS Completion Tasks

This document lists the tasks required to satisfy the acceptance checklist for Helios‑OS 1.0. Existing
features are noted where relevant. Reference lines are cited from the repository.

## 0. Boot & Core Integrity
- **Boot optimisation and login UI** – bring cold boot to <5 s on reference hardware and land a basic login screen.
- **Reboot persistence** – implement `reboot` command and ensure files/services survive restarts by loading saved snapshots.
- **Snapshot restore** – expand snapshot utilities so `snapshot save foo && snapshot load foo` reproduces identical checksums and window layout.

## 1. Kernel & Process Model
- **Enhanced `ps`** – show PID, CPU%, MEM% and TTY (current `ps` only lists pid/argv【F:core/kernel.ts†L515-L519】).
- **Background jobs** – support `sleep 2 &` and `jobs -l` via pre‑emptive scheduling and job table.
- **`/proc` filesystem** – expose `/proc/<pid>/fd` entries reflecting open descriptors.
- **`ulimit` and kill protections** – enforce per‑process memory quotas configurable via `ulimit` and reject `kill -9 1`.

## 2. File System & Package Management
- **Durable WAL filesystem** – hook SQLite based volume (see design【F:docs/persistent_fs.md†L1-L37】) so files survive reboot.
- **Removable media** – implement `mount` and `unmount` for `.vfs` images (kernel has stubs【F:core/kernel.ts†L501-L512】).
- **APT client** – add `apt search` and `apt install` support; packages unpack under `/usr/bin` (referenced in roadmap【F:README.md†L210-L214】).
- **Auto recovery** – run fsck on boot and verify WAL integrity after crashes.

## 3. Shell (/bin/bash)
- **Interactive history** – persist command history across sessions with ↑↓ and Ctrl‑R search.
- **Pipelines and redirection** – implement pipes and `1>&2` style redirection compatible with GNU bash.
- **Tab completion** – add completion for files, commands and packages.

## 4. GUI & Window Manager
- **startx desktop** – launching `startx` should open the desktop with panel and clock (window API already exists【F:ui/index.tsx†L22-L77】).
- **Window controls** – Alt‑drag to move, Alt‑right‑drag to resize and Win+arrow tiling.
- **Clipboard and images** – allow copy/paste of text and small images across windows.
- **Multi‑monitor support** – emulate extra screens via `xrandr --add-monitor`.

## 5. Player‑Written GUI & CLI Apps
- **`helio-cli new gui-app`** – scaffold, build and install templates.
- **postMessage API** – allow iframe apps to send/receive messages through the kernel event bus.
- **Crash handling** – if an app iframe throws, log it and present a restart prompt without killing other windows.

## 6. Networking (LAN + MMO)
- **DHCP and routes** – commands like `ifconfig eth0 up` and `dhclient eth0` to obtain an IP and add routes.
- **Real ping/HTTP** – use TCP/UDP stack so `python3 -m http.server` on one host can serve files to another.
- **Wi‑Fi scanning** – implement `iwlist` and `iwconfig` for wireless NICs.
- **MMO hub** – connect clients to world router for shared chat and file drops among >100 players.
- **Route management** – deleting and re‑adding routes should affect packet forwarding (router/switch classes exist【F:core/net/index.test.ts†L27-L37】).

## 7. Services & Protocol Daemons
- **SSH PTY** – expand sshd so `ssh localhost` opens an interactive shell (basic handler in place【F:core/services/ssh.ts†L8-L18】).
- **SMTP daemon** – `python3 -m smtpd` should receive mail and store in `/var/mail`.
- **FTP server** – allow 10 MiB uploads and verify checksum.
- **P2P coin** – implement simple blockchain node achieving consensus across three peers.

## 8. Security & Sandboxing
- **Iframe FS isolation** – GUI apps must not read `file:///` URLs (sandbox checks).
- **CPU quota enforcement** – kill processes stuck in infinite loops without freezing desktop.
- **Package capability checks** – block native Node API usage unless granted at install time.
- **postMessage validation** – discard messages with spoofed window IDs.

## 9. Persistence & Mods
- **Workshop publish** – `helio-cli publish mymod.helios` uploads to central repo and installs under `/opt`.
- **Theme packages** – installing a theme updates wallpaper and title‑bar CSS.
- **Uninstall cleanup** – removing a mod deletes all files and closes related descriptors.

## 10. Performance Baselines
- Optimise idle RAM to ≤180 MB and ensure boot <5 s.
- Limit CPU slices per process to 16 ms and keep UI above 55 FPS.

## 11. Quality of Life / Polish
- Add configurable keymaps and fonts, in‑game bug reporter, accessible colour‑blind themes, tutorial missions and achievement tracking.

These tasks extend the current codebase—kernel syscalls, filesystem and UI—and will bring Helios‑OS to the full 1.0 specification.
