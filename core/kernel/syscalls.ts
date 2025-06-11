import { invoke } from "@tauri-apps/api/core";
import { eventBus } from "../utils/eventBus";
import { NIC } from "../net/nic";
import { TCP } from "../net/tcp";
import { UDP } from "../net/udp";
import { BASH_SOURCE } from "../fs/bin";
import {
    persistKernelSnapshot,
    saveNamedSnapshot,
    loadNamedSnapshot,
} from "../fs/sqlite";
import type { FileSystemNode, FileSystemSnapshot } from "../fs";
import type { AsyncFileSystem } from "../fs/async";
import type { Kernel, KernelState, WindowOpts, Snapshot } from "./index";
import type { ProcessControlBlock, FileDescriptor, ProcessID } from "./process";
import type { ServiceHandler } from "./index";
import * as fs from "node:fs/promises";
import pathModule from "node:path";

export type SyscallDispatcher = (
    call: string,
    ...args: unknown[]
) => Promise<unknown>;

/**
 * Generate a syscall dispatcher bound to the given PID. Each user program
 * receives a dispatcher that validates the allowed syscall list before routing
 * the call to the kernel implementation.
 */
export function createSyscallDispatcher(
    this: Kernel,
    pid: ProcessID,
): SyscallDispatcher {
    return async (call: string, ...args: unknown[]): Promise<unknown> => {
        const pcb = this.state.processes.get(pid);
        if (!pcb) {
            throw new Error(`Invalid PID ${pid} for syscall`);
        }

        if (pcb.allowedSyscalls && !pcb.allowedSyscalls.has(call)) {
            throw new Error(`Syscall '${call}' not permitted`);
        }

        switch (call) {
            case "open":
                return await this.syscall_open(pcb, args[0], args[1]);
            case "read":
                return await this.syscall_read(pcb, args[0], args[1]);
            case "write":
                return await this.syscall_write(pcb, args[0], args[1]);
            case "close":
                return await this.syscall_close(pcb, args[0]);
            case "spawn":
                return this.syscall_spawn(args[0], args[1]);
            case "listen":
                return this.syscall_listen(args[0], args[1], args[2]);
            case "connect":
                return this.syscall_connect(args[0], args[1]);
            case "tcp_send":
                return this.syscall_tcp_send(args[0], args[1]);
            case "udp_send":
                return this.syscall_udp_send(args[0], args[1]);
            case "draw":
                return this.syscall_draw(args[0], args[1]);
            case "mkdir":
                return await this.syscall_mkdir(args[0], args[1]);
            case "readdir":
                return await this.syscall_readdir(args[0]);
            case "unlink":
                return await this.syscall_unlink(args[0]);
            case "rename":
                return await this.syscall_rename(args[0], args[1]);
            case "mount":
                return await this.syscall_mount(args[0], args[1]);
            case "unmount":
                return await this.syscall_unmount(args[0]);
            case "set_quota":
                return this.syscall_set_quota(pcb, args[0], args[1]);
            case "kill":
                return this.syscall_kill(args[0], args[1]);
            case "snapshot":
                return this.snapshot();
            case "save_snapshot":
                persistKernelSnapshot(this.snapshot());
                return 0;
            case "save_snapshot_named":
                await saveNamedSnapshot(args[0], this.snapshot());
                return 0;
            case "load_snapshot_named": {
                const snap = await loadNamedSnapshot(args[0]);
                if (!snap) return -1;
                this.running = false;
                persistKernelSnapshot(snap);
                eventBus.emit("system.reboot", {});
                return 0;
            }
            case "ps":
                return this.syscall_ps();
            case "jobs":
                return this.syscall_jobs();
            case "reboot":
                return this.reboot();
            default:
                throw new Error(`Unknown syscall: ${call}`);
        }
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
    const node = await this.state.fs.open(path, flags);
    if (node.kind === "dir") {
        throw new Error(
            `EISDIR: illegal operation on a directory, open '${path}'`,
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
            throw new Error("EACCES: permission denied");
        }
        if (needsWrite && !(rights & 2)) {
            throw new Error("EACCES: permission denied");
        }
    }

    const fd = pcb.nextFd++;
    let position = 0;
    if (flags.includes("a")) {
        const data = await this.state.fs.read(path);
        position = data.length;
    }
    pcb.fds.set(fd, { path, position, flags, virtual: (node as { virtual?: boolean }).virtual });
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
        throw new Error("EBADF: bad file descriptor");
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
        throw new Error("EBADF: bad file descriptor");
    }

    if (entry.virtual) {
        throw new Error("EBADF: file not opened for writing");
    }

    if (!entry.flags.includes("w") && !entry.flags.includes("a")) {
        throw new Error("EBADF: file not opened for writing");
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

export interface SpawnOptions {
    argv?: string[];
    uid?: number;
    gid?: number;
    quotaMs?: number;
    quotaMs_total?: number;
    quotaMem?: number;
    tty?: string;
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
    pcb.cpuMs = 0;
    pcb.memBytes = 0;
    pcb.isolateId = pid;
    pcb.started = false;
    if (opts.tty !== undefined) pcb.tty = opts.tty;
    if (opts.syscalls) pcb.allowedSyscalls = new Set(opts.syscalls);
    pcb.code = code;
    pcb.argv = opts.argv ?? [];
    this.readyQueue.push(pcb);
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
    if (!pcb || pid === this.initPid) {
        return -1;
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
        return this.state.tcp.listen(port, cb);
    }
    if (proto === "udp") {
        return this.state.udp.listen(port, cb);
    }
    throw new Error("Unsupported protocol");
}

/**
 * Open a TCP connection to the given address and return a socket id.
 */
export function syscall_connect(
    this: Kernel,
    ip: string,
    port: number,
): number {
    return this.state.tcp.connect(ip, port);
}

/**
 * Send data over an established TCP socket.
 */
export async function syscall_tcp_send(
    this: Kernel,
    sock: number,
    data: Uint8Array,
) {
    return this.state.tcp.send(sock, data);
}

/**
 * Send a UDP datagram.
 */
export async function syscall_udp_send(
    this: Kernel,
    sock: number,
    data: Uint8Array,
) {
    return this.state.udp.send(sock, data);
}

/**
 * Open a new window on the desktop with the provided HTML content.
 */
export function syscall_draw(
    this: Kernel,
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
    return id;
}

/** Create a new directory with the given permissions. */
export async function syscall_mkdir(
    this: Kernel,
    path: string,
    perms: number,
): Promise<number> {
    await this.state.fs.mkdir(path, perms);
    return 0;
}

/** List files in a directory. */
export async function syscall_readdir(
    this: Kernel,
    path: string,
): Promise<FileSystemNode[]> {
    return this.state.fs.readdir(path);
}

/** Remove a file or directory. */
export async function syscall_unlink(
    this: Kernel,
    path: string,
): Promise<number> {
    await this.state.fs.unlink(path);
    return 0;
}

/** Rename a file or directory. */
export async function syscall_rename(
    this: Kernel,
    oldPath: string,
    newPath: string,
): Promise<number> {
    await this.state.fs.rename(oldPath, newPath);
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
    await this.state.fs.mount(snap, mountPoint);
    (this as unknown as { mountedVolumes: Map<string, string> }).mountedVolumes.set(
        mountPoint,
        pathModule.resolve(imagePath),
    );
    return 0;
}

/** Unmount a previously mounted filesystem image. */
export async function syscall_unmount(
    this: Kernel,
    mountPoint: string,
): Promise<number> {
    const kernelWithVolumes = this as unknown as {
        mountedVolumes: Map<string, string>;
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
            if (entry.path === mountPoint || entry.path.startsWith(mountPoint + "/")) {
                pcb.fds.delete(fd);
                this.removeProcFd(pcb.pid, fd);
            }
        }
    }

    if (file && snap) {
        await fs.writeFile(file, JSON.stringify(snap), "utf8");
        kernelWithVolumes.mountedVolumes.delete(mountPoint);
    }
    return 0;
}

/** Adjust CPU and memory quotas for a process. */
export function syscall_set_quota(
    this: Kernel,
    pcb: ProcessControlBlock,
    ms?: number,
    mem?: number,
) {
    if (typeof ms === "number" && !isNaN(ms)) {
        pcb.quotaMs = ms;
    }
    if (typeof mem === "number" && !isNaN(mem)) {
        pcb.quotaMem = mem;
    }
    return { quotaMs: pcb.quotaMs, quotaMem: pcb.quotaMem };
}

/** Return a list of running processes with their resource usage. */
export function syscall_ps(this: Kernel) {
    const list: Array<{
        pid: number;
        argv?: string[];
        exited?: boolean;
        cpuMs: number;
        memBytes: number;
        tty?: string;
    }> = [];
    for (const [pid, pcb] of this.state.processes.entries()) {
        list.push({
            pid,
            argv: pcb.argv,
            exited: pcb.exited,
            cpuMs: pcb.cpuMs,
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
