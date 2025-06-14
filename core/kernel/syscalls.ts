import { invoke } from "@tauri-apps/api/core";
import { eventBus } from "../utils/eventBus";
import { NIC } from "../net/nic";
import { TCP, TcpConnection } from "../net/tcp";
import { UDP, UdpConnection } from "../net/udp";
import { BASH_SOURCE } from "../fs/bin";
import {
    persistKernelSnapshot,
    saveNamedSnapshot,
    loadNamedSnapshot,
} from "../fs/sqlite";
import type { FileSystemNode, FileSystemSnapshot } from "../fs";
import type { FileSystem } from "../fs";
import type { Kernel, KernelState, WindowOpts, Snapshot } from "./index";
import { networkFrom } from "./index";
import type { ProcessControlBlock, FileDescriptor, ProcessID } from "./process";
import type { ServiceHandler } from "./index";
import { KernelError } from "./error";
import * as fs from "node:fs/promises";
import pathModule from "node:path";
import { constants as osConstants } from "node:os";
import { getParentPath } from "../utils/path";

function resolvePath(pcb: ProcessControlBlock, p: string): string {
    if (!p) return pcb.cwd;
    if (p.startsWith("/")) return p;
    const base = pcb.cwd.endsWith("/") ? pcb.cwd : pcb.cwd + "/";
    const combined = base + p;
    const parts = combined.split("/").filter((x) => x && x !== ".");
    const stack: string[] = [];
    for (const part of parts) {
        if (part === "..") stack.pop();
        else stack.push(part);
    }
    return "/" + stack.join("/");
}

export type SyscallDispatcher = (
    call: string,
    ...args: unknown[]
) => Promise<unknown>;

/**
 * Generate a syscall dispatcher bound to the given PID. Each user program
 * receives a dispatcher that validates the allowed syscall list before routing
 * the call to the kernel implementation.
 */
type SyscallHandler = (
    this: Kernel,
    pcb: ProcessControlBlock,
    args: unknown[],
) => Promise<unknown>;

const SYSCALL_HANDLERS: Record<string, SyscallHandler> = {
    open(pcb, args) {
        return this.syscall_open(pcb, args[0] as string, args[1] as string);
    },
    read(pcb, args) {
        return this.syscall_read(pcb, args[0] as FileDescriptor, args[1] as number);
    },
    wait(pcb, args) {
        return this.syscall_wait(pcb, args[0] as FileDescriptor);
    },
    write(pcb, args) {
        return this.syscall_write(pcb, args[0] as FileDescriptor, args[1] as Uint8Array);
    },
    close(pcb, args) {
        return this.syscall_close(pcb, args[0] as FileDescriptor);
    },
    async spawn(pcb, args) {
        const pidNew = await this.syscall_spawn(args[0] as string, args[1]);
        const child = this.state.processes.get(pidNew);
        if (child) child.cwd = (args[1]?.cwd as string | undefined) ?? pcb.cwd;
        return pidNew;
    },
    listen(pcb, args) {
        return this.syscall_listen(args[0] as number, args[1] as string, args[2] as ServiceHandler);
    },
    connect(pcb, args) {
        return this.syscall_connect(args[0] as string, args[1] as number);
    },
    udp_connect(pcb, args) {
        return this.syscall_udp_connect(args[0] as string, args[1] as number);
    },
    tcp_send(pcb, args) {
        return this.syscall_tcp_send(args[0] as TcpConnection, args[1] as Uint8Array);
    },
    udp_send(pcb, args) {
        return this.syscall_udp_send(args[0] as UdpConnection, args[1] as Uint8Array);
    },
    draw(pcb, args) {
        return this.syscall_draw(pcb, args[0] as Uint8Array, args[1] as WindowOpts);
    },
    mkdir(pcb, args) {
        return this.syscall_mkdir(pcb, args[0] as string, args[1] as number);
    },
    readdir(pcb, args) {
        return this.syscall_readdir(pcb, args[0] as string);
    },
    unlink(pcb, args) {
        return this.syscall_unlink(pcb, args[0] as string);
    },
    rename(pcb, args) {
        return this.syscall_rename(pcb, args[0] as string, args[1] as string);
    },
    add_monitor(pcb, args) {
        return this.sys_add_monitor(args[0] as number, args[1] as number);
    },
    remove_monitor(pcb, args) {
        return this.sys_remove_monitor(args[0] as number);
    },
    mount(pcb, args) {
        return this.syscall_mount(args[0] as FileSystem, resolvePath(pcb, args[1] as string));
    },
    unmount(pcb, args) {
        return this.syscall_unmount(resolvePath(pcb, args[0] as string));
    },
    chdir(pcb, args) {
        return this.syscall_chdir(pcb, args[0] as string);
    },
    set_quota(pcb, args) {
        return this.syscall_set_quota(pcb, args[0] as number, args[1] as number);
    },
    kill(pcb, args) {
        return this.syscall_kill(args[0] as ProcessID, args[1] as number | undefined);
    },
    single_user(pcb, args) {
        return this.syscall_single_user(args[0] as boolean | undefined);
    },
    snapshot() {
        return Promise.resolve(this.snapshot());
    },
    save_snapshot() {
        persistKernelSnapshot(this.snapshot());
        return Promise.resolve(0);
    },
    async save_snapshot_named(pcb, args) {
        await saveNamedSnapshot(args[0] as string, this.snapshot());
        return 0;
    },
    async load_snapshot_named(pcb, args) {
        const snap = await loadNamedSnapshot(args[0] as string);
        if (!snap) return -1;
        this.running = false;
        persistKernelSnapshot(snap);
        eventBus.emit("system.reboot", {});
        return 0;
    },
    ps() {
        return Promise.resolve(this.syscall_ps());
    },
    jobs() {
        return Promise.resolve(this.syscall_jobs());
    },
    window_owners() {
        return Promise.resolve(this.syscall_window_owners());
    },
    list_services() {
        return Promise.resolve(this.syscall_list_services());
    },
    stop_service(pcb, args) {
        return this.syscall_stop_service(args[0] as number);
    },
    list_nics() {
        return Promise.resolve(this.syscall_list_nics());
    },
    nic_up(pcb, args) {
        return this.syscall_nic_up(args[0] as string);
    },
    nic_down(pcb, args) {
        return this.syscall_nic_down(args[0] as string);
    },
    nic_config(pcb, args) {
        return this.syscall_nic_config(args[0] as string, args[1] as string, args[2] as string);
    },
    create_nic(pcb, args) {
        return this.syscall_create_nic(
            args[0] as string,
            args[1] as string,
            args[2] as string | undefined,
            args[3] as string | undefined,
            args[4] as "wired" | "wifi" | undefined,
        );
    },
    remove_nic(pcb, args) {
        return this.syscall_remove_nic(args[0] as string);
    },
    dhcp_request(pcb, args) {
        return this.syscall_dhcp_request(args[0] as string);
    },
    wifi_scan() {
        return this.syscall_wifi_scan();
    },
    wifi_join(pcb, args) {
        return this.syscall_wifi_join(args[0] as string, args[1] as string, args[2] as string);
    },
    route_add(pcb, args) {
        return this.syscall_route_add(args[0] as string, args[1] as string);
    },
    route_del(pcb, args) {
        return this.syscall_route_del(args[0] as string);
    },
    reboot() {
        return Promise.resolve(this.reboot());
    },
};

export function createSyscallDispatcher(
    this: Kernel,
    pid: ProcessID,
): SyscallDispatcher {
    return async (call: string, ...args: unknown[]): Promise<unknown> => {
        const pcb = this.state.processes.get(pid);
        if (!pcb) {
            throw new KernelError(
                osConstants.errno.EPERM,
                `Invalid PID ${pid} for syscall`,
            );
        }

        if (pcb.allowedSyscalls && !pcb.allowedSyscalls.has(call)) {
            throw new KernelError(
                osConstants.errno.EPERM,
                `Syscall '${call}' not permitted`,
            );
        }

        const handler = SYSCALL_HANDLERS[call];
        if (!handler) {
            throw new KernelError(osConstants.errno.ENOSYS, `Unknown syscall: ${call}`);
        }
        return handler.call(this, pcb, args);
    };
}

/**
 * Open a file descriptor for a path. Permissions are checked against the
 * calling process before delegating to the filesystem implementation.
 */
export async function syscall_open(
    this: Kernel,
    pcb: ProcessControlBlock,
    path: string,
    flags: string,
): Promise<FileDescriptor> {
    const fullPath = resolvePath(pcb, path);
    if (fullPath.startsWith("/dev/")) {
        return openDeviceFile.call(this, pcb, fullPath, flags);
    }
    return openRegularFile.call(this, pcb, fullPath, flags);
}

async function openDeviceFile(
    this: Kernel,
    pcb: ProcessControlBlock,
    fullPath: string,
    flags: string,
): Promise<FileDescriptor> {
    if (
        fullPath === "/dev/ptmx" ||
        /^\/dev\/tty\d+$/.test(fullPath) ||
        /^\/dev\/pty\d+$/.test(fullPath)
    ) {
        return openPty.call(this, pcb, fullPath, flags);
    }
    return openRegularFile.call(this, pcb, fullPath, flags);
}

async function openPty(
    this: Kernel,
    pcb: ProcessControlBlock,
    fullPath: string,
    flags: string,
): Promise<FileDescriptor> {
    if (fullPath === "/dev/ptmx") {
        const alloc = this.ptys.allocate();
        if (!this.state.fs.getNode(alloc.master)) {
            this.state.fs.createFile(alloc.master, new Uint8Array(), 0o666);
        }
        if (!this.state.fs.getNode(alloc.slave)) {
            this.state.fs.createFile(alloc.slave, new Uint8Array(), 0o666);
        }
        const fd = pcb.nextFd++;
        pcb.fds.set(fd, {
            path: alloc.master,
            position: 0,
            flags,
            ttyId: alloc.id,
            ttySide: "master",
        });
        this.registerProcFd(pcb.pid, fd);
        return fd;
    }

    const ttyMatch = fullPath.match(/^\/dev\/tty(\d+)$/);
    const ptyMatch = fullPath.match(/^\/dev\/pty(\d+)$/);
    const id = parseInt((ttyMatch || ptyMatch)![1], 10);
    if (!this.ptys.exists(id)) {
        const alloc = this.ptys.allocate();
        if (!this.state.fs.getNode(alloc.master)) {
            this.state.fs.createFile(alloc.master, new Uint8Array(), 0o666);
        }
        if (!this.state.fs.getNode(alloc.slave)) {
            this.state.fs.createFile(alloc.slave, new Uint8Array(), 0o666);
        }
    }
    const fd = pcb.nextFd++;
    pcb.fds.set(fd, {
        path: fullPath,
        position: 0,
        flags,
        ttyId: id,
        ttySide: ttyMatch ? "slave" : "master",
    });
    this.registerProcFd(pcb.pid, fd);
    return fd;
}

async function openRegularFile(
    this: Kernel,
    pcb: ProcessControlBlock,
    fullPath: string,
    flags: string,
): Promise<FileDescriptor> {
    const node = await this.state.fs.open(fullPath, flags);
    if (node.kind === "dir") {
        throw new KernelError(
            osConstants.errno.EISDIR,
            `EISDIR: illegal operation on a directory, open '${fullPath}'`,
        );
    }

    const needsRead = flags.includes("r");
    const needsWrite = flags.includes("w") || flags.includes("a");
    if (node) {
        const perm = node.permissions;
        let rights = 0;
        if (pcb.uid === 0) {
            rights = 7;
        } else if (pcb.uid === node.uid) {
            rights = (perm >> 6) & 7;
        } else if (pcb.gid === node.gid) {
            rights = (perm >> 3) & 7;
        } else {
            rights = perm & 7;
        }
        if (needsRead && !(rights & 4)) {
            throw new KernelError(
                osConstants.errno.EACCES,
                "EACCES: permission denied",
            );
        }
        if (needsWrite && !(rights & 2)) {
            throw new KernelError(
                osConstants.errno.EACCES,
                "EACCES: permission denied",
            );
        }
    }

    const fd = pcb.nextFd++;
    let position = 0;
    if (flags.includes("a")) {
        const data = await this.state.fs.read(fullPath);
        position = data.length;
    }
    pcb.fds.set(fd, {
        path: fullPath,
        position,
        flags,
        virtual: (node as { virtual?: boolean }).virtual,
    });
    this.registerProcFd(pcb.pid, fd);
    return fd;
}

/**
 * Read bytes from an open file descriptor.
 */
export async function syscall_read(
    this: Kernel,
    pcb: ProcessControlBlock,
    fd: FileDescriptor,
    length: number,
): Promise<Uint8Array> {
    const entry = pcb.fds.get(fd);
    if (!entry) {
        throw new KernelError(
            osConstants.errno.EBADF,
            "EBADF: bad file descriptor",
        );
    }

    if (entry.ttyId !== undefined) {
        return this.ptys.read(entry.ttyId, entry.ttySide as any, length);
    }
    const data = await this.state.fs.read(entry.path);
    const bytes = data.subarray(entry.position, entry.position + length);
    entry.position += bytes.length;
    return bytes;
}

/**
 * Write data to an open file descriptor. fd 1 and 2 map to stdout/stderr.
 */
export async function syscall_write(
    this: Kernel,
    pcb: ProcessControlBlock,
    fd: FileDescriptor,
    data: Uint8Array,
): Promise<number> {
    if (fd === 1 || fd === 2) {
        const text = new TextDecoder().decode(data);
        console.log(text);
        return data.length;
    }

    const entry = pcb.fds.get(fd);
    if (!entry) {
        throw new KernelError(
            osConstants.errno.EBADF,
            "EBADF: bad file descriptor",
        );
    }

    if (entry.ttyId !== undefined) {
        this.ptys.write(entry.ttyId, entry.ttySide as any, data);
        return data.length;
    }
    if (entry.virtual) {
        throw new KernelError(
            osConstants.errno.EBADF,
            "EBADF: file not opened for writing",
        );
    }

    if (!entry.flags.includes("w") && !entry.flags.includes("a")) {
        throw new KernelError(
            osConstants.errno.EBADF,
            "EBADF: file not opened for writing",
        );
    }

    const current = await this.state.fs.read(entry.path);
    const before = current.slice(0, entry.position);
    const after = current.slice(entry.position + data.length);
    const newData = new Uint8Array(before.length + data.length + after.length);
    newData.set(before, 0);
    newData.set(data, before.length);
    newData.set(after, before.length + data.length);
    await this.state.fs.write(entry.path, newData);
    entry.position += data.length;
    return data.length;
}

/**
 * Close an open file descriptor.
 */
export async function syscall_close(
    this: Kernel,
    pcb: ProcessControlBlock,
    fd: FileDescriptor,
): Promise<number> {
    if (!pcb.fds.has(fd)) {
        return -1;
    }
    pcb.fds.delete(fd);
    this.removeProcFd(pcb.pid, fd);
    return 0;
}

/**
 * Wait until data is available to read from a PTY file descriptor.
 */
export async function syscall_wait(
    this: Kernel,
    pcb: ProcessControlBlock,
    fd: FileDescriptor,
): Promise<number> {
    const entry = pcb.fds.get(fd);
    if (!entry || entry.ttyId === undefined) {
        throw new KernelError(
            osConstants.errno.EBADF,
            "EBADF: bad file descriptor",
        );
    }
    await this.ptys.wait(entry.ttyId, entry.ttySide as any);
    return 0;
}

export interface SpawnOptions {
    argv?: string[];
    uid?: number;
    gid?: number;
    cwd?: string;
    quotaMs?: number;
    quotaMs_total?: number;
    quotaMem?: number;
    tty?: string;
    pty?: boolean;
    syscalls?: string[];
}

/**
 * Create a new process from source code. The program is run inside its own V8
 * isolate with quotas defined by {@link SpawnOptions}.
 */
export async function syscall_spawn(
    this: Kernel,
    code: string,
    opts: SpawnOptions = {},
): Promise<number> {
    const pid = this.createProcess();
    const pcb = this.state.processes.get(pid)!;
    if (opts.uid !== undefined) pcb.uid = opts.uid;
    if (opts.gid !== undefined) pcb.gid = opts.gid;
    if (opts.quotaMs !== undefined) pcb.quotaMs = opts.quotaMs;
    if (opts.quotaMs_total !== undefined)
        pcb.quotaMs_total = opts.quotaMs_total;
    if (opts.quotaMem !== undefined) pcb.quotaMem = opts.quotaMem;
    pcb.cwd = opts.cwd ?? pcb.cwd ?? "/";
    pcb.cpuMs = 0;
    pcb.memBytes = 0;
    pcb.isolateId = pid;
    pcb.started = false;
    if (opts.pty) {
        const alloc = this.ptys.allocate();
        if (!this.state.fs.getNode(alloc.master)) {
            this.state.fs.createFile(alloc.master, new Uint8Array(), 0o666);
        }
        if (!this.state.fs.getNode(alloc.slave)) {
            this.state.fs.createFile(alloc.slave, new Uint8Array(), 0o666);
        }
        pcb.tty = alloc.slave;
    } else if (opts.tty !== undefined) {
        pcb.tty = opts.tty;
    }
    if (opts.syscalls) pcb.allowedSyscalls = new Set(opts.syscalls);
    pcb.code = code;
    pcb.spawnCode = code;
    pcb.spawnOpts = { ...opts };
    pcb.argv = opts.argv ?? [];
    this.readyQueue.push(pcb);
    (this as any).idleDelay = (this as any).baseIdleDelay;
    if (code === BASH_SOURCE) {
        eventBus.emit("boot.shellReady", { pid });
    }
    return pid;
}

/**
 * Terminate a process by PID. Sending signal 9 forcibly kills the isolate.
 */
export function syscall_kill(this: Kernel, pid: number, sig?: number): number {
    const pcb = this.state.processes.get(pid);
    if (!pcb) {
        return -1;
    }
    if (pid === this.initPid) {
        if (!this.singleUser || (sig !== undefined && sig !== 15)) {
            return -1;
        }
    }
    pcb.exited = true;
    pcb.exitCode = sig ?? 9;
    invoke("drop_isolate", { pid: pcb.isolateId }).catch(() => {});
    this.readyQueue = this.readyQueue.filter((p) => p.pid !== pid);
    for (const [id, job] of this.jobs.entries()) {
        if (job.pids.includes(pid)) {
            this.updateJobStatus(id, "Killed");
        }
    }
    return 0;
}

/** Enable or query single-user mode. */
export function syscall_single_user(this: Kernel, on?: boolean) {
    if (typeof on === "boolean") {
        this.singleUser = on;
    }
    return this.singleUser;
}

/**
 * Start listening on a TCP or UDP port and register the callback as a service.
 */
export function syscall_listen(
    this: Kernel,
    port: number,
    proto: string,
    cb: ServiceHandler,
): number {
    if (proto === "tcp") {
        return this.state.tcp.listen(port, cb as any);
    }
    if (proto === "udp") {
        return this.state.udp.listen(port, cb as any);
    }
    throw new KernelError(
        osConstants.errno.EPROTONOSUPPORT,
        "Unsupported protocol",
    );
}

/**
 * Open a TCP connection to the given address and return a socket id.
 */
export function syscall_connect(
    this: Kernel,
    ip: string,
    port: number,
): TcpConnection {
    return this.state.tcp.connect(ip, port);
}

/**
 * Open a UDP socket to the given address and return a socket id.
 */
export function syscall_udp_connect(
    this: Kernel,
    ip: string,
    port: number,
): UdpConnection {
    return this.state.udp.connect(ip, port);
}

/**
 * Send data over an established TCP socket.
 */
export async function syscall_tcp_send(
    this: Kernel,
    sock: TcpConnection,
    data: Uint8Array,
) {
    sock.write(data);
    return 0;
}

/**
 * Send a UDP datagram.
 */
export async function syscall_udp_send(
    this: Kernel,
    sock: UdpConnection,
    data: Uint8Array,
) {
    sock.write(data);
    return 0;
}

/** Add a monitor to the display configuration. */
export function sys_add_monitor(
    this: Kernel,
    width: number,
    height: number,
): number {
    return this.addMonitor(width, height);
}

/** Remove a monitor by id. */
export function sys_remove_monitor(this: Kernel, id: number): number {
    return this.removeMonitor(id);
}

/**
 * Open a new window on the desktop with the provided HTML content.
 */
export function syscall_draw(
    this: Kernel,
    pcb: ProcessControlBlock,
    html: Uint8Array,
    opts: WindowOpts,
): number {
    const id = this.state.windows.length;
    const windows = this.state.windows.slice();
    windows.push({ html, opts });
    this.state = { ...this.state, windows } as KernelState;
    const payload = {
        id,
        html: new TextDecoder().decode(html),
        opts,
    };
    eventBus.emit("desktop.createWindow", payload);
    (this as any).windowOwners?.set(id, pcb.pid);
    return id;
}

/** Create a new directory with the given permissions. */
export async function syscall_mkdir(
    this: Kernel,
    pcb: ProcessControlBlock,
    path: string,
    perms: number,
): Promise<number> {
    const fullPath = resolvePath(pcb, path);
    const parentPath = getParentPath(fullPath);
    const parent = this.state.fs.getNode(parentPath);
    if (parent) {
        const perm = parent.permissions;
        let rights = 0;
        if (pcb.uid === 0) {
            rights = 7;
        } else if (pcb.uid === parent.uid) {
            rights = (perm >> 6) & 7;
        } else if (pcb.gid === parent.gid) {
            rights = (perm >> 3) & 7;
        } else {
            rights = perm & 7;
        }
        if (!(rights & 2)) {
            throw new KernelError(
                osConstants.errno.EACCES,
                "EACCES: permission denied",
            );
        }
    }
    await this.state.fs.mkdir(fullPath, perms);
    return 0;
}

/** List files in a directory. */
export async function syscall_readdir(
    this: Kernel,
    pcb: ProcessControlBlock,
    path: string,
): Promise<FileSystemNode[]> {
    const fullPath = resolvePath(pcb, path);
    const node = this.state.fs.getNode(fullPath);
    if (node) {
        const perm = node.permissions;
        let rights = 0;
        if (pcb.uid === 0) {
            rights = 7;
        } else if (pcb.uid === node.uid) {
            rights = (perm >> 6) & 7;
        } else if (pcb.gid === node.gid) {
            rights = (perm >> 3) & 7;
        } else {
            rights = perm & 7;
        }
        if (!(rights & 4)) {
            throw new KernelError(
                osConstants.errno.EACCES,
                "EACCES: permission denied",
            );
        }
    }
    return this.state.fs.readdir(fullPath);
}

/** Remove a file or directory. */
export async function syscall_unlink(
    this: Kernel,
    pcb: ProcessControlBlock,
    path: string,
): Promise<number> {
    const fullPath = resolvePath(pcb, path);
    const node = this.state.fs.getNode(fullPath);
    if (node) {
        const perm = node.permissions;
        let rights = 0;
        if (pcb.uid === 0) {
            rights = 7;
        } else if (pcb.uid === node.uid) {
            rights = (perm >> 6) & 7;
        } else if (pcb.gid === node.gid) {
            rights = (perm >> 3) & 7;
        } else {
            rights = perm & 7;
        }
        if (!(rights & 2)) {
            throw new KernelError(
                osConstants.errno.EACCES,
                "EACCES: permission denied",
            );
        }
    }
    await this.state.fs.unlink(fullPath);
    return 0;
}

/** Rename a file or directory. */
export async function syscall_rename(
    this: Kernel,
    pcb: ProcessControlBlock,
    oldPath: string,
    newPath: string,
): Promise<number> {
    const oldFull = resolvePath(pcb, oldPath);
    const node = this.state.fs.getNode(oldFull);
    if (node) {
        const perm = node.permissions;
        let rights = 0;
        if (pcb.uid === 0) {
            rights = 7;
        } else if (pcb.uid === node.uid) {
            rights = (perm >> 6) & 7;
        } else if (pcb.gid === node.gid) {
            rights = (perm >> 3) & 7;
        } else {
            rights = perm & 7;
        }
        if (!(rights & 2)) {
            throw new KernelError(
                osConstants.errno.EACCES,
                "EACCES: permission denied",
            );
        }
    }
    await this.state.fs.rename(oldFull, resolvePath(pcb, newPath));
    return 0;
}

/** Change the current working directory. */
export async function syscall_chdir(
    this: Kernel,
    pcb: ProcessControlBlock,
    path: string,
): Promise<number> {
    const full = resolvePath(pcb, path);
    try {
        await this.state.fs.readdir(full);
    } catch {
        return -1;
    }
    pcb.cwd = full;
    return 0;
}

/** Mount a filesystem snapshot at the given path. */
export async function syscall_mount(
    this: Kernel,
    imagePath: string,
    mountPoint: string,
): Promise<number> {
    const raw = await fs.readFile(imagePath, "utf8");
    const snap = JSON.parse(raw) as FileSystemSnapshot;
    const kernelWithVolumes = this as unknown as {
        mountedVolumes: Map<string, string>;
        updateProcMounts: () => void;
    };
    if (kernelWithVolumes.mountedVolumes.has(mountPoint)) {
        throw new Error(`EEXIST: mount point busy, mount '${mountPoint}'`);
    }
    await this.state.fs.mount(snap, mountPoint);
    kernelWithVolumes.mountedVolumes.set(
        mountPoint,
        pathModule.resolve(imagePath),
    );
    kernelWithVolumes.updateProcMounts();
    return 0;
}

/** Unmount a previously mounted filesystem image. */
export async function syscall_unmount(
    this: Kernel,
    mountPoint: string,
): Promise<number> {
    const kernelWithVolumes = this as unknown as {
        mountedVolumes: Map<string, string>;
        updateProcMounts: () => void;
    };
    const file = kernelWithVolumes.mountedVolumes.get(mountPoint);
    let snap: FileSystemSnapshot | undefined;
    const fsAny = this.state.fs as unknown as {
        snapshotSubtree?: (p: string) => FileSystemSnapshot;
    };
    if (file && fsAny.snapshotSubtree) {
        snap = fsAny.snapshotSubtree(mountPoint);
    }

    await this.state.fs.unmount(mountPoint);

    for (const pcb of this.state.processes.values()) {
        for (const [fd, entry] of pcb.fds) {
            if (
                entry.path === mountPoint ||
                entry.path.startsWith(mountPoint + "/")
            ) {
                pcb.fds.delete(fd);
                this.removeProcFd(pcb.pid, fd);
            }
        }
    }

    if (file && snap) {
        await fs.writeFile(file, JSON.stringify(snap), "utf8");
        kernelWithVolumes.mountedVolumes.delete(mountPoint);
    }
    kernelWithVolumes.updateProcMounts();
    return 0;
}

/** Adjust CPU and memory quotas for a process. */
export function syscall_set_quota(
    this: Kernel,
    pcb: ProcessControlBlock,
    ms?: number,
    mem?: number,
    total?: number,
) {
    if (typeof ms === "number" && !isNaN(ms)) {
        pcb.quotaMs = ms;
    }
    if (typeof mem === "number" && !isNaN(mem)) {
        pcb.quotaMem = mem;
    }
    if (typeof total === "number" && !isNaN(total)) {
        pcb.quotaMs_total = total;
    }
    return {
        quotaMs: pcb.quotaMs,
        quotaMs_total: pcb.quotaMs_total,
        quotaMem: pcb.quotaMem,
    };
}

/** Return a list of running processes with their resource usage. */
export function syscall_ps(this: Kernel) {
    const list: Array<{
        pid: number;
        argv?: string[];
        exited?: boolean;
        cpuMs: number;
        recentCpuMs: number;
        memBytes: number;
        tty?: string;
    }> = [];
    for (const [pid, pcb] of this.state.processes.entries()) {
        const recentCpuMs = Array.isArray(pcb.cpuHistory)
            ? pcb.cpuHistory.reduce((n, v) => n + v, 0)
            : 0;
        list.push({
            pid,
            argv: pcb.argv,
            exited: pcb.exited,
            cpuMs: pcb.cpuMs,
            recentCpuMs,
            memBytes: pcb.memBytes,
            tty: pcb.tty,
        });
    }
    return list;
}

/** List background jobs tracked by the shell. */
export function syscall_jobs(this: Kernel) {
    return Array.from(this.jobs.values());
}

/** Return window owner mapping entries. */
export function syscall_window_owners(this: Kernel) {
    return Array.from((this as any).windowOwners?.entries() || []);
}

/** List registered services. */
export function syscall_list_services(this: Kernel) {
    return Array.from(this.state.services.entries());
}

/** Stop a service by name. */
export function syscall_stop_service(this: Kernel, name: string) {
    this.stopService(name);
    return 0;
}

/** List network interfaces */
export function syscall_list_nics(this: Kernel) {
    return Array.from(this.state.nics.values()).map((n) => ({
        id: n.id,
        mac: n.mac,
        ip: n.ip,
        netmask: n.netmask,
        status: n.status,
        ssid: n.ssid,
    }));
}

/** Bring a NIC up */
export function syscall_nic_up(this: Kernel, id: string) {
    const nic = this.state.nics.get(id);
    if (!nic) return -1;
    nic.status = "up";
    return 0;
}

/** Bring a NIC down */
export function syscall_nic_down(this: Kernel, id: string) {
    const nic = this.state.nics.get(id);
    if (!nic) return -1;
    nic.status = "down";
    return 0;
}

/** Configure IP and netmask */
export function syscall_nic_config(
    this: Kernel,
    id: string,
    ip: string,
    mask: string,
) {
    const nic = this.state.nics.get(id);
    if (!nic) return -1;
    nic.ip = ip;
    nic.netmask = mask;
    return 0;
}

/** Create a NIC */
export function syscall_create_nic(
    this: Kernel,
    id: string,
    mac: string,
    ip?: string,
    mask?: string,
    type: "wired" | "wifi" = "wired",
) {
    if (this.state.nics.has(id)) return -1;
    const nic = new NIC(id, mac, ip, mask, "down", undefined, type);
    this.state.nics.set(id, nic);
    return 0;
}

/** Remove a NIC */
export function syscall_remove_nic(this: Kernel, id: string) {
    if (!this.state.nics.has(id)) return -1;
    this.state.nics.delete(id);
    return 0;
}

/** Obtain an IP via DHCP */
export async function syscall_dhcp_request(this: Kernel, id: string) {
    const nic = this.state.nics.get(id);
    if (!nic) return -1;
    try {
        const res: { ip: string; netmask: string } = await invoke("dhcp_request", {
            nicId: id,
        });
        nic.ip = res.ip;
        nic.netmask = res.netmask;
        const cidr = networkFrom(res.ip, res.netmask);
        this.syscall_route_add(cidr, id);
        return res;
    } catch {
        return -1;
    }
}

/** Scan for available Wi-Fi networks */
export async function syscall_wifi_scan(this: Kernel) {
    try {
        const list: string[] = await invoke("wifi_scan", {});
        return list;
    } catch {
        return [];
    }
}

/** Join a Wi-Fi network */
export async function syscall_wifi_join(
    this: Kernel,
    id: string,
    ssid: string,
    pass: string,
) {
    const nic = this.state.nics.get(id);
    if (!nic) return -1;
    try {
        const ok: boolean = await invoke("wifi_join", {
            nicId: id,
            ssid,
            passphrase: pass,
        });
        if (!ok) return -1;
        nic.ssid = ssid;
        nic.status = "up";
        await this.syscall_dhcp_request(id);
        return 0;
    } catch {
        return -1;
    }
}

/** Add a route */
export function syscall_route_add(this: Kernel, cidr: string, nicId: string) {
    const nic = this.state.nics.get(nicId);
    if (!nic) return -1;
    this.state.routes.set(cidr, nicId);
    this.router.addRoute(cidr, nic);
    return 0;
}

/** Delete a route */
export function syscall_route_del(this: Kernel, cidr: string) {
    if (!this.state.routes.has(cidr)) return -1;
    this.state.routes.delete(cidr);
    this.router.removeRoute(cidr);
    return 0;
}
