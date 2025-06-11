# Persistent File System Design

This document outlines the durable VFS backed by SQLite used in Helios-OS. It replaces the earlier in-memory model while keeping the same open/read/write API exposed to user programs.

## 1. High-level architecture

```
┌─────────────┐          IPC (JSON)
│   React UI  │──────────────┐
└─────────────┘              │
              ┌──────────────▼──────────────┐
              │  Kernel (TypeScript)        │
              │  – path parser / FD table   │
              │  – page cache (LRU)         │
              └───────┬────────┬────────────┘
                      │async/await
       tauri-plugin-sql│          ▲ flush/evict
                      ▼          │
              ┌─────────────────────────┐
              │      SQLite volume      │  helios.vfs
              └─────────────────────────┘
```

* The kernel caches hot files and directories in memory, but SQLite remains the source of truth.
* Each filesystem call runs in a single-statement transaction. Writes use `BEGIN IMMEDIATE` and `COMMIT`.
* The Tauri SQL plugin runs queries in the host's thread pool so kernel isolates never block the UI.

## 2. Schema definition

```sql
-- helios.vfs
PRAGMA journal_mode = WAL;   -- safe for concurrent reads
PRAGMA foreign_keys = ON;

CREATE TABLE inodes (
    id        INTEGER PRIMARY KEY,
    parent_id INTEGER,
    name      TEXT NOT NULL,
    mode      INTEGER NOT NULL,
    uid       INTEGER NOT NULL,
    gid       INTEGER NOT NULL,
    size      INTEGER NOT NULL DEFAULT 0,
    ctime     INTEGER NOT NULL,
    mtime     INTEGER NOT NULL,
    atime     INTEGER NOT NULL,
    kind      TEXT    NOT NULL,
    target    TEXT,
    CHECK (kind IN ('file','dir','symlink')),
    FOREIGN KEY(parent_id) REFERENCES inodes(id) ON DELETE CASCADE,
    UNIQUE(parent_id, name)
);

CREATE TABLE file_data (
    inode_id INTEGER PRIMARY KEY,
    blob     BLOB NOT NULL,
    FOREIGN KEY(inode_id) REFERENCES inodes(id) ON DELETE CASCADE
);

CREATE TABLE compile_cache (
    sha256      TEXT PRIMARY KEY,
    compiled_js BLOB NOT NULL,
    ts_mtime    INTEGER NOT NULL
);
```

A single row per file keeps CRUD simple until files routinely exceed tens of MiB.

## 3. Boot-strap volume

On first launch the kernel creates `helios.vfs` and populates standard directories. Subsequent boots skip initialization if the `inodes` table already exists.

## 4. Path resolution

A lookup function walks each path component, caching directory IDs in an LRU map. Negative results can also be cached to reduce repeated `ENOENT` checks.

## 5. Syscall implementations

### open

New files are created when opened with write flags. The inode's `atime` is updated on every open.

### read

Data is fetched from `file_data`, sliced according to the file descriptor's position and length, and the position is advanced.

### write

Writes merge the new bytes into the existing blob, update the inode size and modification time, and advance the descriptor position.

## 6. Executable layout

```
/bin/*       Core userland programs shipped with Helios-OS
/usr/bin/*   Packages installed via the fake APT client
/lib/*.d.ts  TypeScript type stubs shipped with the toolchain
/home/<user>/…  Player scripts and notes
/etc/*       Config files
```

Executables are TypeScript files. The kernel hashes the source, checks `compile_cache` for a matching compiled blob, and compiles with esbuild on a miss.

### Package index

Available packages are listed in `/etc/apt/index.json`. Each entry provides the
path to a tarball and an optional SHA-256 checksum. The `apt` CLI reads this
file for `search` and `install` operations and extracts files into `/usr/bin`.

## 7. Recovery procedure

* On boot the kernel checkpoints the WAL using `PRAGMA wal_checkpoint(FULL)`.
* `PRAGMA integrity_check` verifies the database and logs any corruption.
* Core directories such as `/etc`, `/bin` and `/sbin` are recreated if missing.
* Any repairs are printed so the player can be notified after a crash.

## 8. Performance considerations

* A small page cache avoids repeated DB lookups for hot data.
* Metadata updates can be batched and flushed periodically.
* Call `PRAGMA wal_checkpoint(TRUNCATE)` on shutdown to keep the DB compact.

## 9. Atomic snapshot & restore

Because every change is transactional, a snapshot is a safe copy of `helios.vfs` while no write is active. Restoring is just replacing the file and restarting.

## 10. Extensibility hooks

* Additional volumes can be attached with `ATTACH DATABASE` and mounted at paths like `/mnt/usb1`.
* Quotas can be enforced by adding a `quota` column to inodes.
* Extended attributes can be stored in a new `xattrs` table.

## 11. Outcome

* Files and packages persist across restarts.
* Package installs survive reboot without extra steps.
* SQLite's ACID guarantees integrity, and snapshots offer extra protection.

