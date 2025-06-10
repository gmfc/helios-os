// Helios-OS Kernel
// Implementation to follow based on the project roadmap.

import {
    InMemoryFileSystem,
    FileSystemNode,
    FileSystemSnapshot,
    loadFileSystem,
} from "../fs";
import type { AsyncFileSystem } from "../fs/async";
import { bootstrapFileSystem } from "../fs/pure";
import {
    createPersistHook,
    loadKernelSnapshot,
    persistKernelSnapshot,
    saveNamedSnapshot,
    loadNamedSnapshot,
} from "../fs/sqlite";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { eventBus } from "../utils/eventBus";
import { NIC } from "../net/nic";
import { TCP } from "../net/tcp";
import { UDP } from "../net/udp";
import { BASH_SOURCE } from "../fs/bin";
import { startHttpd, startSshd, startPingService } from "../services";
import {
    ProcessID,
    FileDescriptor,
    ProcessControlBlock,
    dispatcherMap,
    createProcess,
    cleanupProcess,
    ensureProcRoot,
    registerProc,
    registerProcFd,
    removeProcFd,
    procStatus,
    runProcess,
    registerJob,
    removeJob,
    updateJobStatus,
} from "./process";
import {
    SyscallDispatcher,
    createSyscallDispatcher,
    syscall_open,
    syscall_read,
    syscall_write,
    syscall_close,
    syscall_spawn,
    syscall_kill,
    syscall_listen,
    syscall_connect,
    syscall_tcp_send,
    syscall_udp_send,
    syscall_draw,
    syscall_mkdir,
    syscall_readdir,
    syscall_unlink,
    syscall_rename,
    syscall_mount,
    syscall_unmount,
    syscall_set_quota,
    syscall_ps,
    syscall_jobs,
} from "./syscalls";

type Program = {
    main: (syscall: SyscallDispatcher, argv: string[]) => Promise<number>;
};

export interface SpawnOpts {
    argv?: string[];
    uid?: number;
    gid?: number;
    quotaMs?: number;
    quotaMs_total?: number;
    quotaMem?: number;
    syscalls?: string[];
    tty?: string;
}

export type ServiceHandler = (data: Uint8Array) => Promise<Uint8Array | void>;

export interface WindowOpts {
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
}

export interface Snapshot {
    fs?: any;
    processes: any;
    windows: Array<{ html: Uint8Array; opts: WindowOpts }>;
    nextPid: number;
    nics: any;
    tcp: any;
    udp: any;
    services: any;
    initPid: number | null;
}

/**
 * The Helios-OS Kernel, responsible for process, file, and system management.
 */
export interface KernelState {
    fs: AsyncFileSystem;
    processes: Map<ProcessID, ProcessControlBlock>;
    nextPid: ProcessID;
    nics: Map<string, NIC>;
    tcp: TCP;
    udp: UDP;
    windows: Array<{ html: Uint8Array; opts: WindowOpts }>;
    services: Map<string, { port: number; proto: string }>;
}

export class Kernel {
    private state: KernelState;
    private readyQueue: ProcessControlBlock[];
    private running = false;
    private initPid: ProcessID | null = null;
    private pendingNics: Array<any> | null = null;
    private networkingStarted = false;
    private jobs: Map<
        number,
        { id: number; pids: number[]; command: string; status: string }
    > = new Map();
    private nextJob = 1;
    private createProcess = createProcess;
    private cleanupProcess = cleanupProcess;
    private ensureProcRoot = ensureProcRoot;
    private registerProc = registerProc;
    private registerProcFd = registerProcFd;
    private removeProcFd = removeProcFd;
    private procStatus = procStatus;
    private runProcess = runProcess;
    public registerJob = registerJob;
    public removeJob = removeJob;
    public updateJobStatus = updateJobStatus;
    public createSyscallDispatcher = createSyscallDispatcher;
    private syscall_open = syscall_open;
    private syscall_read = syscall_read;
    private syscall_write = syscall_write;
    private syscall_close = syscall_close;
    private syscall_spawn = syscall_spawn;
    private syscall_kill = syscall_kill;
    private syscall_listen = syscall_listen;
    private syscall_connect = syscall_connect;
    private syscall_tcp_send = syscall_tcp_send;
    private syscall_udp_send = syscall_udp_send;
    private syscall_draw = syscall_draw;
    private syscall_mkdir = syscall_mkdir;
    private syscall_readdir = syscall_readdir;
    private syscall_unlink = syscall_unlink;
    private syscall_rename = syscall_rename;
    private syscall_mount = syscall_mount;
    private syscall_unmount = syscall_unmount;
    private syscall_set_quota = syscall_set_quota;
    private syscall_ps = syscall_ps;
    private syscall_jobs = syscall_jobs;

    private constructor(fs: AsyncFileSystem) {
        this.state = {
            fs,
            processes: new Map(),
            nextPid: 1,
            nics: new Map(),
            tcp: new TCP(),
            udp: new UDP(),
            windows: [],
            services: new Map(),
        };
        this.readyQueue = [];
    }

    public static async create(): Promise<Kernel> {
        const full = await loadKernelSnapshot();
        if (full) {
            return Kernel.restore(full as Snapshot);
        }

        const fs = (await loadFileSystem()) ?? bootstrapFileSystem();
        const kernel = new Kernel(fs);
        kernel.pendingNics = [
            {
                id: "lo0",
                mac: "00:00:00:00:00:00",
                ip: "127.0.0.1",
                rx: [],
                tx: [],
            },
        ];
        if (typeof window !== "undefined") {
            listen("syscall", async (event: any) => {
                const { id, pid, call, args } = event.payload as any;
                const disp = dispatcherMap.get(pid);
                if (!disp) return;
                const result = await disp(call, ...args);
                await invoke("syscall_response", { id, result });
            });
        }
        try {
            const initData = await fs.read("/sbin/init");
            const code = new TextDecoder().decode(initData);
            let syscalls: string[] | undefined;
            try {
                const mdata = await fs.read("/sbin/init.manifest.json");
                const parsed = JSON.parse(new TextDecoder().decode(mdata));
                if (Array.isArray(parsed.syscalls)) syscalls = parsed.syscalls;
            } catch {}
            kernel.initPid = await kernel.syscall_spawn(code, { syscalls });
        } catch (e) {
            console.error("Failed to spawn init:", e);
        }
        return kernel;
    }

    public static async restore(snapshot: Snapshot): Promise<Kernel> {
        const reviver = (_: string, value: any) => {
            if (value && typeof value === "object") {
                if (value.dataType === "Map") {
                    return new Map(value.value);
                }
                if (value.dataType === "Set") {
                    return new Set<string>(value.value);
                }
                if (value.dataType === "Uint8Array") {
                    if (typeof Buffer !== "undefined") {
                        return new Uint8Array(
                            Buffer.from(value.value, "base64"),
                        );
                    }
                    const bin = atob(value.value);
                    const arr = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++)
                        arr[i] = bin.charCodeAt(i);
                    return arr;
                }
                if (value.dataType === "NIC") {
                    const nic = new NIC(value.id, value.mac, value.ip);
                    nic.rx = value.rx ?? [];
                    nic.tx = value.tx ?? [];
                    return nic;
                }
                if (value.dataType === "TCP") {
                    const tcp = new TCP();
                    (tcp as any).listeners = new Map(value.listeners ?? []);
                    (tcp as any).sockets = new Map(value.sockets ?? []);
                    (tcp as any).nextSocket = value.nextSocket ?? 1;
                    return tcp;
                }
                if (value.dataType === "UDP") {
                    const udp = new UDP();
                    (udp as any).listeners = new Map(value.listeners ?? []);
                    (udp as any).sockets = new Map(value.sockets ?? []);
                    (udp as any).nextSocket = value.nextSocket ?? 1;
                    return udp;
                }
            }
            return value;
        };
        const parsed: Snapshot = JSON.parse(JSON.stringify(snapshot), reviver);

        const fs: AsyncFileSystem = snapshot.fs
            ? new InMemoryFileSystem(snapshot.fs, createPersistHook())
            : ((await loadFileSystem()) ?? bootstrapFileSystem());
        const kernel = new Kernel(fs);
        kernel.state.processes = new Map(parsed.processes ?? []);
        kernel.state.nextPid = parsed.nextPid ?? 1;
        kernel.state.windows = parsed.windows ?? [];
        for (const [id, win] of kernel.state.windows.entries()) {
            eventBus.emit("desktop.createWindow", {
                id,
                html: new TextDecoder().decode(win.html),
                opts: win.opts,
            });
        }
        kernel.state.services = new Map(parsed.services ?? []);
        kernel.initPid = parsed.initPid ?? null;

        kernel.pendingNics = parsed.nics
            ? Array.from(parsed.nics.values())
            : [];

        kernel.state.tcp = parsed.tcp instanceof TCP ? parsed.tcp : new TCP();

        kernel.state.udp = parsed.udp instanceof UDP ? parsed.udp : new UDP();

        for (const [name, svc] of kernel.state.services.entries()) {
            if (name.startsWith("httpd")) {
                startHttpd(kernel, { port: svc.port });
            } else if (name.startsWith("sshd")) {
                startSshd(kernel, { port: svc.port });
            } else if (name.startsWith("pingd")) {
                startPingService(kernel, { port: svc.port });
            }
        }

        if (typeof window !== "undefined") {
            listen("syscall", async (event: any) => {
                const { id, pid, call, args } = event.payload as any;
                const disp = dispatcherMap.get(pid);
                if (!disp) return;
                const result = await disp(call, ...args);
                await invoke("syscall_response", { id, result });
            });
        }

        for (const pid of kernel.state.processes.keys()) {
            kernel.registerProc(pid);
            const pcb = kernel.state.processes.get(pid)!;
            if (pcb.quotaMs_total === undefined) pcb.quotaMs_total = Infinity;
            if (pcb.started === undefined) pcb.started = false;
            for (const fd of pcb.fds.keys()) {
                kernel.registerProcFd(pid, fd);
            }
        }

        kernel.readyQueue = Array.from(kernel.state.processes.values()).filter(
            (p) => !p.exited,
        );

        return kernel;
    }

    public async spawn(command: string, opts: SpawnOpts = {}): Promise<number> {
        const [progName, ...argv] = command.split(" ").filter(Boolean);
        const path = `/bin/${progName}`; // Assume programs are in /bin
        const manifestPath = `/bin/${progName}.manifest.json`;

        let source: string;
        try {
            const data = await this.state.fs.read(path);
            source = new TextDecoder().decode(data);
        } catch (e) {
            console.error(`-helios: ${progName}: command not found`);
            return 127;
        }

        let manifestSyscalls: string[] | undefined;
        try {
            const mdata = await this.state.fs.read(manifestPath);
            const { syscalls } = JSON.parse(new TextDecoder().decode(mdata));
            if (Array.isArray(syscalls)) manifestSyscalls = syscalls;
        } catch {}

        return this.syscall_spawn(source, {
            argv,
            syscalls: manifestSyscalls,
            ...opts,
        });
    }

    public registerService(
        name: string,
        port: number,
        proto: string,
        handler: ServiceHandler,
    ): void {
        this.syscall_listen(port, proto, handler);
        const services = new Map(this.state.services);
        services.set(name, { port, proto });
        this.state = { ...this.state, services };
    }

    public stopService(name: string): void {
        const svc = this.state.services.get(name);
        if (!svc) return;
        if (svc.proto === "tcp") {
            this.state.tcp.unlisten(svc.port);
        } else if (svc.proto === "udp") {
            this.state.udp.unlisten(svc.port);
        }
        const services = new Map(this.state.services);
        services.delete(name);
        this.state = { ...this.state, services };
    }

    public startNetworking(): void {
        if (this.networkingStarted) return;
        this.networkingStarted = true;
        this.state.nics = new Map();
        const list = this.pendingNics ?? [];
        if (list.length === 0) {
            list.push({
                id: "lo0",
                mac: "00:00:00:00:00:00",
                ip: "127.0.0.1",
                rx: [],
                tx: [],
            });
        }
        for (const [, nic] of list.entries()) {
            const n = new NIC(nic.id, nic.mac, nic.ip);
            n.rx = nic.rx ?? [];
            n.tx = nic.tx ?? [];
            this.state.nics.set(n.id, n);
        }
        this.pendingNics = null;
    }

    public snapshot(): Snapshot {
        const replacer = (_: string, value: any) => {
            if (value instanceof Map) {
                return { dataType: "Map", value: Array.from(value.entries()) };
            }
            if (value instanceof Set) {
                return { dataType: "Set", value: Array.from(value) };
            }
            if (value instanceof Uint8Array) {
                const str =
                    typeof Buffer !== "undefined"
                        ? Buffer.from(value).toString("base64")
                        : btoa(String.fromCharCode(...Array.from(value)));
                return { dataType: "Uint8Array", value: str };
            }
            if (value instanceof NIC) {
                return {
                    dataType: "NIC",
                    id: value.id,
                    mac: value.mac,
                    ip: value.ip,
                    rx: value.rx,
                    tx: value.tx,
                };
            }
            if (value instanceof TCP) {
                return {
                    dataType: "TCP",
                    listeners: Array.from((value as any).listeners.entries()),
                    sockets: Array.from((value as any).sockets.entries()),
                    nextSocket: (value as any).nextSocket,
                };
            }
            if (value instanceof UDP) {
                return {
                    dataType: "UDP",
                    listeners: Array.from((value as any).listeners.entries()),
                    sockets: Array.from((value as any).sockets.entries()),
                    nextSocket: (value as any).nextSocket,
                };
            }
            return value;
        };

        const fsSnapshot = (this.state.fs as any).getSnapshot
            ? (this.state.fs as any).getSnapshot()
            : undefined;
        const state: Snapshot = {
            fs: fsSnapshot,
            processes: this.state.processes,
            windows: this.state.windows,
            nextPid: this.state.nextPid,
            nics: this.state.nics,
            tcp: this.state.tcp,
            udp: this.state.udp,
            services: this.state.services,
            initPid: this.initPid,
        };

        return JSON.parse(JSON.stringify(state, replacer));
    }

    public async start(): Promise<void> {
        this.running = true;
        while (this.running) {
            const queue = this.readyQueue.slice();
            this.readyQueue = [];
            if (queue.length === 0) {
                await new Promise((r) => setTimeout(r, 1));
                continue;
            }
            for (const pcb of queue) {
                await this.runProcess(pcb);
                if (!pcb.exited) {
                    this.readyQueue.push(pcb);
                }
            }
        }
    }

    public async stop(): Promise<void> {
        persistKernelSnapshot(this.snapshot());
        if ((this.state.fs as any).close) {
            try {
                await (this.state.fs as any).close();
            } catch (e) {
                console.error(e);
            }
        }
        this.running = false;
    }

    public async reboot(): Promise<void> {
        await this.stop();
        eventBus.emit("system.reboot", {});
    }
}

export type { ProcessID, FileDescriptor, ProcessControlBlock } from "./process";
export type { SyscallDispatcher } from "./syscalls";
