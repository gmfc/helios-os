# Kernel Guide

The kernel is implemented entirely in TypeScript under `core/`. It maintains the machine state as an in-memory tree and exposes asynchronous syscalls to user programs.

## Key Components

- `fs/` – In-memory filesystem. Files are stored as nodes with Unix‑style permissions. Snapshots are persisted via a small SQLite database.
- `net/` – Simple network stack providing NICs, TCP and UDP sockets. Routers and switches are also written in TypeScript.
- `services/` – Built‑in daemons such as the HTTP and SSH servers.
- `utils/eventBus.ts` – Lightweight event emitter used for UI messages and service events.
- `kernel.ts` – The main scheduler, process table and syscall implementations.

Processes are executed inside V8 isolates spawned by the host. Each process has
quotas for CPU time and memory. The host reports how many milliseconds of CPU
time were used and the peak memory size after each run. Those numbers are
accumulated into `pcb.cpuMs` and `pcb.memBytes` on the kernel side. When a
program is spawned with a `tty` option the device name is stored in `pcb.tty` so
utilities can show where a process is attached. Syscalls are dispatched through
a message bus to the kernel.

### Snapshotting

`core/fs/sqlite.ts` provides helpers to load and persist the entire kernel state. A snapshot is pure JSON that captures files, running processes and network connections. Loading a snapshot recreates the same environment deterministically.

When the kernel stops or reboots the host stores the current snapshot to disk. On the next boot `Kernel.create()` loads that snapshot so all windows and services resume exactly where they left off. Users can also manage save slots with `save_snapshot_named(name)` and `load_snapshot_named(name)` through the `/sbin/snapshot` utility.

### Virtual files

The filesystem supports *virtual nodes* that do not persist to disk. Each `FileSystemNode` may set `virtual: true` and provide an `onRead` callback:

```ts
interface FileSystemNode {
    path: string;
    kind: 'file' | 'dir';
    permissions: number;
    uid: number;
    gid: number;
    createdAt: Date;
    modifiedAt: Date;
    data?: Uint8Array;
    children?: Map<string, FileSystemNode>;
    virtual?: boolean;
    onRead?: () => Uint8Array | FileSystemNode[];
}
```

For files the callback returns the contents on demand. For directories it returns a list of nodes to expose. This mechanism powers `/proc` and can be used by developers to add custom runtime information.

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
| `connect(ip, port)` | open a socket connection |
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

### Process accounting

Each process keeps runtime counters:

- `cpuMs` – total CPU milliseconds consumed.
- `memBytes` – memory used while running.
- `tty` – TTY device attached when spawned.

The `ps` syscall exposes these values along with a moving-average CPU% so
userland can inspect resource usage. Example output from the bundled `ps`
program:

```
PID %CPU %MEM TTY COMMAND
1 32.5 18.9 tty0 /bin/bash
2  1.0  0.3 tty0 ping 127.0.0.1
3  0.0  0.1 ?   ps
```

### `/proc` filesystem

Runtime information is exposed through a virtual tree under `/proc`. Nothing is
stored on disk; entries are generated on demand.

Creation steps for each process:

1. `ensureProcRoot()` creates the `/proc` directory if missing.
2. `registerProc(pid)` adds `/proc/<pid>` and a virtual `status` file whose
   callback serializes the PCB.
3. A virtual `fd` directory is created for descriptor listings.
4. A `cmdline` file exposes the command used to start the process.
5. `registerProcFd(pid, fd)` creates `/proc/<pid>/fd/<fd>` whenever a new
   descriptor is opened. `removeProcFd()` deletes the entry on close.

Reading `/proc/<pid>/status` prints details such as:

```text
pid:\t5
uid:\t1000
cpuMs:\t42
memBytes:\t2048
tty:\t/dev/tty0
cmd:\tping 127.0.0.1
```

The `/proc/<pid>/cmdline` file contains the command line used to
spawn the process:

```text
$ cat /proc/5/cmdline
ping 127.0.0.1
```

Listing `/proc/<pid>/fd` shows numbers for each open descriptor, and each file
contains the resolved path:

```text
$ ls /proc/5/fd
0 1 2 3
$ cat /proc/5/fd/3
/tmp/foo.txt
```

This layout mirrors Linux behaviour and lets players introspect processes from
userland utilities. Developers can extend `/proc` by creating additional
virtual files or directories under `/proc/<pid>` using the callbacks described
above.

### Reboot and restore

The `/sbin/reboot` command calls `kernel.reboot()`. This persists the current
snapshot via `save_snapshot()` and stops the scheduler. On the next boot
`Kernel.create()` loads that snapshot, recreating services and open windows so
the desktop resumes exactly where it left off. Calling
`load_snapshot_named(name)` loads the requested snapshot, saves it as the active
one and reboots automatically so the restored state becomes live.
The `/sbin/snapshot` utility provides `snapshot save <name>` and `snapshot load <name>` for manual state management.

### Job control

The shell keeps a small job table. Commands ending with `&` are spawned in the
background and immediately return to the prompt. Use `jobs` to list entries,
`fg <id>` to wait on a job and `bg <id>` to resume a stopped one.
