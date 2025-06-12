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
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { eventBus } from "../utils/eventBus";
import { NIC } from "../net/nic";
import { TCP, TcpHandler } from "../net/tcp";
import { UDP, UdpHandler } from "../net/udp";
import { BASH_SOURCE } from "../fs/bin";

interface TcpInternal {
    listeners: Map<number, TcpHandler>;
    sockets: Map<number, { ip: string; port: number }>;
    nextSocket: number;
}

interface UdpInternal {
    listeners: Map<number, UdpHandler>;
    sockets: Map<number, { ip: string; port: number }>;
    nextSocket: number;
}
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
    syscall_list_nics,
    syscall_nic_up,
    syscall_nic_down,
    syscall_nic_config,
    syscall_create_nic,
    syscall_remove_nic,
} from "./syscalls";

type Program = {
    main: (syscall: SyscallDispatcher, argv: string[]) => Promise<number>;
};

export interface SpawnOpts {
    argv?: string[];
    uid?: number;
    gid?: number;
    cwd?: string;
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
    monitorId?: number;
}

export interface Monitor {
    width: number;
    height: number;
    x: number;
    y: number;
}

export interface Snapshot {
    fs?: unknown;
    processes: unknown;
    windows: Array<{ html: Uint8Array; opts: WindowOpts }>;
    nextPid: number;
    nics: unknown;
    tcp: unknown;
    udp: unknown;
    services: unknown;
    initPid: number | null;
    monitors: Monitor[];
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
    monitors: Monitor[];
}

export class Kernel {
    private state: KernelState;
    private readyQueue: ProcessControlBlock[];
    private running = false;
    private initPid: ProcessID | null = null;
    private pendingNics: Array<NIC> | null = null;
    private networkingStarted = false;
    private jobs: Map<
        number,
        { id: number; pids: number[]; command: string; status: string }
    > = new Map();
    private nextJob = 1;
    private mountedVolumes: Map<string, string> = new Map();
    private windowOwners: Map<number, ProcessID> = new Map();
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
    private syscall_list_nics = syscall_list_nics;
    private syscall_nic_up = syscall_nic_up;
    private syscall_nic_down = syscall_nic_down;
    private syscall_nic_config = syscall_nic_config;
    private syscall_create_nic = syscall_create_nic;
    private syscall_remove_nic = syscall_remove_nic;

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
            monitors: [
                { width: 800, height: 600, x: 0, y: 0 },
            ],
        };
        this.readyQueue = [];
        eventBus.on("desktop.windowRecv", (payload) => this.handleWindowMessage(payload));
    }

    /**
     * Create a new kernel instance. If a saved snapshot exists it will be
     * restored so services, windows and processes resume exactly where they
     * were on the last shutdown.
     */
    public static async create(): Promise<Kernel> {
        const full = await loadKernelSnapshot();
        if (full) {
            return Kernel.restore(full as Snapshot);
        }

        const fs = (await loadFileSystem()) ?? bootstrapFileSystem();
        const kernel = new Kernel(fs);
        eventBus.emit("desktop.updateMonitors", kernel.state.monitors);
        kernel.pendingNics = [
            {
                id: "lo0",
                mac: "00:00:00:00:00:00",
                ip: "127.0.0.1",
                netmask: "255.0.0.0",
                status: "up",
                rx: [],
                tx: [],
            },
        ];
        if (typeof window !== "undefined") {
            listen<{ id: number; pid: number; call: string; args: unknown[] }>("syscall", async (event) => {
                const { id, pid, call, args } = event.payload;
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
        const reviver = (_: string, value: unknown) => {
            if (value && typeof value === "object" && "dataType" in value) {
                const v = value as Record<string, unknown>;
                if (v.dataType === "Map") {
                    return new Map(v.value as Iterable<[unknown, unknown]>);
                }
                if (v.dataType === "Set") {
                    return new Set<string>(v.value as string[]);
                }
                if (v.dataType === "Uint8Array") {
                    const str = v.value as string;
                    if (typeof Buffer !== "undefined") {
                        return new Uint8Array(Buffer.from(str, "base64"));
                    }
                    const bin = atob(str);
                    const arr = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                    return arr;
                }
                if (v.dataType === "NIC") {
                    const nic = new NIC(
                        String(v.id),
                        String(v.mac),
                        v.ip as string | undefined,
                        v.netmask as string | undefined,
                        (v.status as "up" | "down") ?? "down",
                        v.ssid as string | undefined,
                    );
                    nic.rx = (v.rx as unknown[]) ?? [];
                    nic.tx = (v.tx as unknown[]) ?? [];
                    return nic;
                }
                if (v.dataType === "TCP") {
                    const tcp = new TCP();
                    (tcp as unknown as TcpInternal).listeners = new Map(v.listeners as Iterable<[number, TcpHandler]> ?? []);
                    (tcp as unknown as TcpInternal).sockets = new Map(v.sockets as Iterable<[number, { ip: string; port: number }]> ?? []);
                    (tcp as unknown as TcpInternal).nextSocket = (v.nextSocket as number) ?? 1;
                    return tcp;
                }
                if (v.dataType === "UDP") {
                    const udp = new UDP();
                    (udp as unknown as UdpInternal).listeners = new Map(v.listeners as Iterable<[number, UdpHandler]> ?? []);
                    (udp as unknown as UdpInternal).sockets = new Map(v.sockets as Iterable<[number, { ip: string; port: number }]> ?? []);
                    (udp as unknown as UdpInternal).nextSocket = (v.nextSocket as number) ?? 1;
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

        kernel.state.monitors = parsed.monitors && parsed.monitors.length
            ? parsed.monitors
            : [{ width: 800, height: 600, x: 0, y: 0 }];
        eventBus.emit("desktop.updateMonitors", kernel.state.monitors);

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
            listen<{ id: number; pid: number; call: string; args: unknown[] }>("syscall", async (event) => {
                const { id, pid, call, args } = event.payload;
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
            cwd: opts.cwd ?? "/",
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
            const n = new NIC(
                nic.id,
                nic.mac,
                nic.ip,
                nic.netmask,
                (nic.status as "up" | "down") ?? "down",
                nic.ssid,
            );
            n.rx = nic.rx ?? [];
            n.tx = nic.tx ?? [];
            this.state.nics.set(n.id, n);
        }
        this.pendingNics = null;
    }

    public addMonitor(width: number, height: number): number {
        const id = this.state.monitors.length;
        const x = this.state.monitors.reduce((s, m) => s + m.width, 0);
        const monitors = this.state.monitors.concat({ width, height, x, y: 0 });
        this.state = { ...this.state, monitors };
        eventBus.emit("desktop.updateMonitors", monitors);
        return id;
    }

    public removeMonitor(id: number): number {
        if (id <= 0 || id >= this.state.monitors.length) return -1;
        const monitors = this.state.monitors.slice();
        monitors.splice(id, 1);
        let offset = 0;
        for (const m of monitors) {
            m.x = offset;
            offset += m.width;
        }
        for (const w of this.state.windows) {
            if (w.opts.monitorId === id) w.opts.monitorId = 0;
            else if ((w.opts.monitorId ?? 0) > id) w.opts.monitorId!--;
        }
        this.state = { ...this.state, monitors };
        eventBus.emit("desktop.updateMonitors", monitors);
        return 0;
    }

    private handleWindowMessage(payload: { id: number; data: any }): void {
        const source = payload.id;
        const owner = this.windowOwners.get(source);
        if (owner === undefined) return;
        const msg = payload.data as any;
        if (!msg || typeof msg !== "object") return;
        if (msg.source !== undefined && msg.source !== source) return;
        const target = msg.target;
        if (typeof target !== "number" || !this.windowOwners.has(target)) return;
        eventBus.emit("desktop.windowPost", { id: target, data: msg });
    }

    public snapshot(): Snapshot {
        const replacer = (_: string, value: unknown) => {
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
                    netmask: value.netmask,
                    status: value.status,
                    ssid: value.ssid,
                    rx: value.rx,
                    tx: value.tx,
                };
            }
            if (value instanceof TCP) {
                const tcpVal = value as unknown as TcpInternal;
                return {
                    dataType: "TCP",
                    listeners: Array.from(tcpVal.listeners.entries()),
                    sockets: Array.from(tcpVal.sockets.entries()),
                    nextSocket: tcpVal.nextSocket,
                };
            }
            if (value instanceof UDP) {
                const udpVal = value as unknown as UdpInternal;
                return {
                    dataType: "UDP",
                    listeners: Array.from(udpVal.listeners.entries()),
                    sockets: Array.from(udpVal.sockets.entries()),
                    nextSocket: udpVal.nextSocket,
                };
            }
            return value;
        };

        const fsWithSnapshot = this.state.fs as unknown as {
            getSnapshot?: () => FileSystemSnapshot;
        };
        const fsSnapshot = fsWithSnapshot.getSnapshot
            ? fsWithSnapshot.getSnapshot()
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
            monitors: this.state.monitors,
        };

        return JSON.parse(JSON.stringify(state, replacer));
    }

    /**
     * Run the scheduler loop until {@link stop} is called. Each process in the
     * ready queue receives a time slice according to its quota.
     */
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
        const fsClosable = this.state.fs as unknown as { close?: () => Promise<void> };
        if (fsClosable.close) {
            try {
                await fsClosable.close();
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

declare const vitest: unknown | undefined;
export const kernelTest = (typeof vitest !== "undefined" || process.env.VITEST)
    ? {
          createKernel: (fs: AsyncFileSystem) => {
              const k = new Kernel(fs);
              (k as any).createProcess();
              return k;
          },
          getState: (k: Kernel) => (k as any).state as KernelState,
          setInitPid: (k: Kernel, pid: ProcessID) => {
              (k as any).initPid = pid;
          },
          setRunProcess: (
              k: Kernel,
              fn: (pcb: ProcessControlBlock) => Promise<void>,
          ) => {
              (k as any).runProcess = fn;
          },
          createProcess: (k: Kernel) => (k as any).createProcess(),
          runProcess: (k: Kernel, pcb: ProcessControlBlock) =>
              (k as any).runProcess(pcb),
          syscall_spawn: (k: Kernel, code: string, opts?: SpawnOpts) =>
              syscall_spawn.call(k, code, opts),
          syscall_mount: (
              k: Kernel,
              file: string,
              path: string,
          ) => syscall_mount.call(k, file, path),
          syscall_unmount: (k: Kernel, path: string) =>
              syscall_unmount.call(k, path),
          syscall_open: (
              k: Kernel,
              pcb: ProcessControlBlock,
              path: string,
              flags: string,
          ) => syscall_open.call(k, pcb, path, flags),
          syscall_read: (
              k: Kernel,
              pcb: ProcessControlBlock,
              fd: FileDescriptor,
              len: number,
          ) => syscall_read.call(k, pcb, fd, len),
          syscall_draw: (
              k: Kernel,
              pcb: ProcessControlBlock,
              html: Uint8Array,
              opts: WindowOpts,
          ) => syscall_draw.call(k, pcb, html, opts),
          syscall_readdir: (
              k: Kernel,
              pcb: ProcessControlBlock,
              path: string,
          ) => syscall_readdir.call(k, pcb, path),
          syscall_kill: (k: Kernel, pid: number, sig?: number) =>
              syscall_kill.call(k, pid, sig),
          syscall_set_quota: (
              k: Kernel,
              pcb: ProcessControlBlock,
              ms?: number,
              mem?: number,
          ) => syscall_set_quota.call(k, pcb, ms, mem),
          syscall_ps: (k: Kernel) => syscall_ps.call(k),
          syscall_jobs: (k: Kernel) => syscall_jobs.call(k),
          syscall_list_nics: (k: Kernel) => syscall_list_nics.call(k),
          syscall_nic_up: (k: Kernel, id: string) => syscall_nic_up.call(k, id),
          syscall_nic_down: (k: Kernel, id: string) => syscall_nic_down.call(k, id),
          syscall_nic_config: (
              k: Kernel,
              id: string,
              ip: string,
              mask: string,
          ) => syscall_nic_config.call(k, id, ip, mask),
          syscall_create_nic: (
              k: Kernel,
              id: string,
              mac: string,
              ip?: string,
              mask?: string,
          ) => syscall_create_nic.call(k, id, mac, ip, mask),
          syscall_remove_nic: (k: Kernel, id: string) => syscall_remove_nic.call(k, id),
          addMonitor: (k: Kernel, w: number, h: number) => k.addMonitor(w, h),
          removeMonitor: (k: Kernel, id: number) => k.removeMonitor(id),
      }
    : undefined;
