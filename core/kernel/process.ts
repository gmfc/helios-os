// Process management utilities for the Helios-OS Kernel

import { invoke } from "@tauri-apps/api/core";
import { totalmem } from "node:os";
import type { SyscallDispatcher, SpawnOptions } from "./syscalls";
import type { Kernel } from "./index";
import { eventBus } from "../utils/eventBus";

export const DEFAULT_QUOTA_MEM = Math.max(
    2 * 1024 * 1024,
    Math.floor(totalmem() / 128),
);

export type ProcessID = number;
export type FileDescriptor = number;

export interface FileDescriptorEntry {
    path: string;
    position: number;
    flags: string;
    virtual?: boolean;
    ttyId?: number;
    ttySide?: "master" | "slave";
}

export interface ProcessControlBlock {
    pid: ProcessID;
    isolateId: number;
    uid: number;
    gid: number;
    cwd: string;
    quotaMs: number;
    quotaMs_total: number;
    quotaMem: number;
    cpuMs: number;
    memBytes: number;
    /** Recent CPU slice history for moving average */
    cpuHistory: number[];
    /** Number of times the process has exceeded CPU or memory quota. */
    quotaViolations?: number;
    tty?: string;
    started: boolean;
    allowedSyscalls?: Set<string>;
    fds: Map<FileDescriptor, FileDescriptorEntry>;
    nextFd: FileDescriptor;
    code?: string;
    argv?: string[];
    spawnCode?: string;
    spawnOpts?: SpawnOptions;
    exited?: boolean;
    exitCode?: number;
}

export const dispatcherMap: Map<ProcessID, SyscallDispatcher> = new Map();

export function createProcess(this: Kernel): ProcessID {
    const pid = this.state.nextPid++;
    const pcb: ProcessControlBlock = {
        pid,
        isolateId: pid,
        uid: 1000,
        gid: 1000,
        cwd: "/",
        quotaMs: 10,
        quotaMs_total: Infinity,
        quotaMem: DEFAULT_QUOTA_MEM,
        cpuMs: 0,
        memBytes: 0,
        cpuHistory: [],
        quotaViolations: 0,
        tty: undefined,
        started: false,
        allowedSyscalls: undefined,
        fds: new Map(),
        nextFd: 3,
        spawnCode: undefined,
        spawnOpts: undefined,
        exited: false,
    };
    const processes = new Map(this.state.processes);
    processes.set(pid, pcb);
    this.state = { ...this.state, processes };
    this.registerProc(pid);
    return pid;
}

export function cleanupProcess(this: Kernel, pid: ProcessID): void {
    const processes = new Map(this.state.processes);
    processes.delete(pid);
    this.state = { ...this.state, processes };
}

export function ensureProcRoot(this: Kernel): void {
    if (!this.state.fs.getNode("/proc")) {
        this.state.fs.createVirtualDirectory("/proc", 0o555);
    }
}

export function registerProc(this: Kernel, pid: ProcessID): void {
    this.ensureProcRoot();
    if (!this.state.fs.getNode(`/proc/${pid}`)) {
        this.state.fs.createVirtualDirectory(`/proc/${pid}`, 0o555);
    }
    if (!this.state.fs.getNode(`/proc/${pid}/status`)) {
        this.state.fs.createVirtualFile(
            `/proc/${pid}/status`,
            () => this.procStatus(pid),
            0o444,
        );
    }
    if (!this.state.fs.getNode(`/proc/${pid}/cmdline`)) {
        this.state.fs.createVirtualFile(
            `/proc/${pid}/cmdline`,
            () => this.procCmdline(pid),
            0o444,
        );
    }
    if (!this.state.fs.getNode(`/proc/${pid}/fd`)) {
        this.state.fs.createVirtualDirectory(`/proc/${pid}/fd`, 0o555);
    }
}

export function registerProcFd(this: Kernel, pid: ProcessID, fd: number): void {
    const pcb = this.state.processes.get(pid);
    if (!pcb) return;
    if (!this.state.fs.getNode(`/proc/${pid}/fd/${fd}`)) {
        this.state.fs.createVirtualFile(
            `/proc/${pid}/fd/${fd}`,
            () => {
                const entry = pcb.fds.get(fd);
                return new TextEncoder().encode(entry ? entry.path : "");
            },
            0o444,
        );
    }
}

export function removeProcFd(this: Kernel, pid: ProcessID, fd: number): void {
    const path = `/proc/${pid}/fd/${fd}`;
    if (this.state.fs.getNode(path)) {
        this.state.fs.remove(path);
    }
}

export function updateProcMounts(this: Kernel): void {
    this.ensureProcRoot();
    const enc = new TextEncoder();
    const entries = Array.from((this as any).mountedVolumes.entries()).map(
        ([mount, file]) => `${mount} ${file}`,
    );
    const data = entries.join("\n") + (entries.length ? "\n" : "");
    const existing = this.state.fs.getNode("/proc/mounts");
    const reader = () => enc.encode(data);
    if (!existing) {
        this.state.fs.createVirtualFile("/proc/mounts", reader, 0o444);
    } else if (existing.kind === "file") {
        existing.onRead = reader;
    }
}

export function procStatus(this: Kernel, pid: ProcessID): Uint8Array {
    const pcb = this.state.processes.get(pid);
    if (!pcb) return new Uint8Array();
    const enc = new TextEncoder();
    const cmd = pcb.argv ? pcb.argv.join(" ") : "";
    const out =
        `pid:\t${pid}\nuid:\t${pcb.uid}\n` +
        `cpuMs:\t${pcb.cpuMs}\nmemBytes:\t${pcb.memBytes}\n` +
        `tty:\t${pcb.tty ?? ""}\ncmd:\t${cmd}\n`;
    return enc.encode(out);
}

export function procCmdline(this: Kernel, pid: ProcessID): Uint8Array {
    const pcb = this.state.processes.get(pid);
    if (!pcb) return new Uint8Array();
    const enc = new TextEncoder();
    const out = (pcb.argv ?? []).join("\0");
    return enc.encode(out + (out ? "\0" : ""));
}

export async function runProcess(
    this: Kernel,
    pcb: ProcessControlBlock,
): Promise<void> {
    if (!pcb.started && !pcb.code) return;
    const syscall = this.createSyscallDispatcher(pcb.pid);
    dispatcherMap.set(pcb.pid, syscall);
    const args: Record<string, any> = {
        pid: pcb.isolateId,
        sliceMs: pcb.quotaMs,
        quotaMem: pcb.quotaMem,
    };
    if (!pcb.started) {
        const wrapped = `const main = ${pcb.code}; main(syscall, ${JSON.stringify(pcb.argv ?? [])});`;
        args.code = wrapped;
    }
    try {
        const result: any = await invoke("run_isolate_slice", args);
        if (!pcb.started) {
            pcb.started = true;
            pcb.code = undefined;
        }
        if (result) {
            const slice = result.cpu_ms ?? 0;
            pcb.cpuMs += slice;
            pcb.memBytes += result.mem_bytes ?? 0;
            pcb.cpuHistory.push(slice);
            if (pcb.cpuHistory.length > 60) pcb.cpuHistory.shift();
            if (pcb.cpuMs > pcb.quotaMs_total || pcb.memBytes > pcb.quotaMem) {
                pcb.quotaViolations = (pcb.quotaViolations ?? 0) + 1;
                if (pcb.quotaViolations > 1) {
                    const owners = (this as any).windowOwners as Map<number, ProcessID>;
                    let emitted = false;
                    for (const [wid, owner] of owners.entries()) {
                        if (owner === pcb.pid) {
                            eventBus.emit("desktop.appCrashed", {
                                id: wid,
                                code: pcb.spawnCode ?? "",
                                opts: pcb.spawnOpts ?? {},
                            });
                            emitted = true;
                        }
                    }
                    if (!emitted) {
                        console.warn("Process", pcb.pid, "repeatedly exceeded quota");
                    }
                } else {
                    console.warn("Process", pcb.pid, "exceeded quota");
                }
                this.syscall_kill(pcb.pid, 9);
            } else if (!result.running) {
                pcb.exitCode = result.exit_code ?? 0;
                pcb.exited = true;
            }
        } else {
            pcb.exitCode = 0;
            pcb.exited = true;
        }
    } catch (e) {
        console.error("Process", pcb.pid, "crashed or exceeded quota:", e);
        pcb.exitCode = 1;
        pcb.exited = true;
    }
    if (pcb.exited) {
        try {
            await invoke("drop_isolate", { pid: pcb.isolateId });
        } catch {}
        if ((pcb.exitCode ?? 0) !== 0) {
            const owners = (this as any).windowOwners as Map<number, ProcessID>;
            for (const [wid, owner] of owners.entries()) {
                if (owner === pcb.pid) {
                    eventBus.emit("desktop.appCrashed", {
                        id: wid,
                        code: pcb.spawnCode ?? "",
                        opts: pcb.spawnOpts ?? {},
                    });
                }
            }
        }
    }
    dispatcherMap.delete(pcb.pid);
}

export function registerJob(
    this: Kernel,
    pids: number[],
    command: string,
): number {
    const id = this.nextJob++;
    const jobs = new Map(this.jobs);
    const entry = { id, pids, command, status: "Running" };
    jobs.set(id, entry);
    this.jobs = jobs;
    return id;
}

export function removeJob(this: Kernel, id: number): void {
    const jobs = new Map(this.jobs);
    jobs.delete(id);
    this.jobs = jobs;
}

export function updateJobStatus(
    this: Kernel,
    id: number,
    status: string,
): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const jobs = new Map(this.jobs);
    jobs.set(id, { ...job, status });
    this.jobs = jobs;
}
