// Helios-OS Kernel
// Implementation to follow based on the project roadmap. 

import { InMemoryFileSystem, FileSystemNode, FileSystemSnapshot } from './fs';
import { bootstrapFileSystem } from './fs/pure';
import {
  loadSnapshot,
  createPersistHook,
  loadKernelSnapshot,
  persistKernelSnapshot,
} from './fs/sqlite';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { eventBus } from './eventBus';
import { NIC } from './net/nic';
import { TCP } from './net/tcp';
import { UDP } from './net/udp';

type ProcessID = number;
type FileDescriptor = number;

/**
 * Represents a single entry in a process's file descriptor table.
 */
interface FileDescriptorEntry {
  node: FileSystemNode;
  position: number;
  flags: string; // e.g., 'r', 'w', 'rw'
}

/**
 * Process Control Block: Stores the state of a single process.
 */
interface ProcessControlBlock {
  pid: ProcessID;
  uid: number;
  gid: number;
  quotaMs: number;
  quotaMem: number;
  allowedSyscalls?: Set<string>;
  fds: Map<FileDescriptor, FileDescriptorEntry>;
  nextFd: FileDescriptor;
  code?: string;
  argv?: string[];
  exited?: boolean;
  exitCode?: number;
}

type Program = {
  main: (syscall: SyscallDispatcher, argv: string[]) => Promise<number>;
};

export interface SpawnOpts {
  argv?: string[];
  uid?: number;
  gid?: number;
  quotaMs?: number;
  quotaMem?: number;
  syscalls?: string[];
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
  fs: any;
  processes: any;
  windows: Array<{ html: Uint8Array; opts: WindowOpts }>;
  nextPid: number;
  nics: any;
  tcp: any;
  udp: any;
  services: any;
}

/**
 * A function that dispatches a syscall to the kernel for a specific process.
 */
export type SyscallDispatcher = (call: string, ...args: any[]) => Promise<any>;

const dispatcherMap: Map<ProcessID, SyscallDispatcher> = new Map();

/**
 * The Helios-OS Kernel, responsible for process, file, and system management.
 */
export interface KernelState {
  fs: InMemoryFileSystem;
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

  private constructor(fs: InMemoryFileSystem) {
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

    const snapshot = await loadSnapshot();
    const fs = snapshot
        ? new InMemoryFileSystem(snapshot, createPersistHook())
        : bootstrapFileSystem();
    const kernel = new Kernel(fs);
    const lo = new NIC('lo0', '00:00:00:00:00:00', '127.0.0.1');
    kernel.state.nics.set(lo.id, lo);
    if (typeof window !== 'undefined') {
      listen('syscall', async (event: any) => {
        const { id, pid, call, args } = event.payload as any;
        const disp = dispatcherMap.get(pid);
        if (!disp) return;
        const result = await disp(call, ...args);
        await invoke('syscall_response', { id, result });
      });
    }
    return kernel;
  }

  public static async restore(snapshot: Snapshot): Promise<Kernel> {
    const fs = new InMemoryFileSystem(snapshot.fs ?? undefined, createPersistHook());
    const kernel = new Kernel(fs);

    kernel.state.processes = new Map(snapshot.processes ?? []);
    kernel.state.nextPid = snapshot.nextPid ?? 1;
    kernel.state.windows = snapshot.windows ?? [];
    kernel.state.services = new Map(snapshot.services ?? []);

    kernel.state.nics = new Map();
    if (snapshot.nics) {
      for (const [id, nic] of snapshot.nics) {
        const n = new NIC(nic.id, nic.mac, nic.ip);
        n.rx = nic.rx ?? [];
        n.tx = nic.tx ?? [];
        kernel.state.nics.set(id, n);
      }
    }

    kernel.state.tcp = new TCP();
    if (snapshot.tcp) {
      (kernel.state.tcp as any).listeners = new Map(snapshot.tcp.listeners ?? []);
      (kernel.state.tcp as any).sockets = new Map(snapshot.tcp.sockets ?? []);
      (kernel.state.tcp as any).nextSocket = snapshot.tcp.nextSocket ?? 1;
    }

    kernel.state.udp = new UDP();
    if (snapshot.udp) {
      (kernel.state.udp as any).listeners = new Map(snapshot.udp.listeners ?? []);
      (kernel.state.udp as any).sockets = new Map(snapshot.udp.sockets ?? []);
      (kernel.state.udp as any).nextSocket = snapshot.udp.nextSocket ?? 1;
    }

    if (typeof window !== 'undefined') {
      listen('syscall', async (event: any) => {
        const { id, pid, call, args } = event.payload as any;
        const disp = dispatcherMap.get(pid);
        if (!disp) return;
        const result = await disp(call, ...args);
        await invoke('syscall_response', { id, result });
      });
    }

    kernel.readyQueue = Array.from(kernel.state.processes.values()).filter(p => !p.exited);

    return kernel;
  }

  public async spawn(command: string, opts: SpawnOpts = {}): Promise<number> {
    const [progName, ...argv] = command.split(' ').filter(Boolean);
    const path = `/bin/${progName}`; // Assume programs are in /bin
    const manifestPath = `/bin/${progName}.manifest.json`;

    let source: string;
    try {
      const node = this.state.fs.getNode(path);
      if (!node || node.kind !== 'file' || !node.data) {
        throw new Error();
      }
      source = new TextDecoder().decode(node.data);
    } catch (e) {
      console.error(`-helios: ${progName}: command not found`);
      return 127;
    }

    let manifestSyscalls: string[] | undefined;
    try {
      const mnode = this.state.fs.getNode(manifestPath);
      if (mnode && mnode.kind === 'file' && mnode.data) {
        const { syscalls } = JSON.parse(new TextDecoder().decode(mnode.data));
        if (Array.isArray(syscalls)) manifestSyscalls = syscalls;
      }
    } catch {}

    return this.syscall_spawn(source, { argv, syscalls: manifestSyscalls, ...opts });
  }

  public registerService(name: string, port: number, proto: string, handler: ServiceHandler): void {
    this.syscall_listen(port, proto, handler);
    const services = new Map(this.state.services);
    services.set(name, { port, proto });
    this.state = { ...this.state, services };
  }

  public stopService(name: string): void {
    const svc = this.state.services.get(name);
    if (!svc) return;
    if (svc.proto === 'tcp') {
      this.state.tcp.unlisten(svc.port);
    } else if (svc.proto === 'udp') {
      this.state.udp.unlisten(svc.port);
    }
    const services = new Map(this.state.services);
    services.delete(name);
    this.state = { ...this.state, services };
  }

  private createProcess(): ProcessID {
    const pid = this.state.nextPid++;
    const pcb: ProcessControlBlock = {
      pid,
      uid: 1000,
      gid: 1000,
      quotaMs: 10,
      quotaMem: 8 * 1024 * 1024,
      allowedSyscalls: undefined,
      fds: new Map(),
      nextFd: 3, // 0, 1, 2 are reserved for stdio
      exited: false,
    };
    const processes = new Map(this.state.processes);
    processes.set(pid, pcb);
    this.state = { ...this.state, processes };
    return pid;
  }

  private cleanupProcess(pid: ProcessID) {
    const processes = new Map(this.state.processes);
    processes.delete(pid);
    this.state = { ...this.state, processes };
  }

  private createSyscallDispatcher(pid: ProcessID): SyscallDispatcher {
    return async (call: string, ...args: any[]): Promise<any> => {
      const pcb = this.state.processes.get(pid);
      if (!pcb) {
        throw new Error(`Invalid PID ${pid} for syscall`);
      }

      if (pcb.allowedSyscalls && !pcb.allowedSyscalls.has(call)) {
        throw new Error(`Syscall '${call}' not permitted`);
      }

      switch (call) {
        case 'open':
          return this.syscall_open(pcb, args[0], args[1]);
        case 'read':
          return this.syscall_read(pcb, args[0], args[1]);
        case 'write':
          return this.syscall_write(pcb, args[0], args[1]);
        case 'close':
          return this.syscall_close(pcb, args[0]);
        case 'spawn':
          return this.syscall_spawn(args[0], args[1]);
        case 'listen':
          return this.syscall_listen(args[0], args[1], args[2]);
        case 'connect':
          return this.syscall_connect(args[0], args[1]);
        case 'tcp_send':
          return this.syscall_tcp_send(args[0], args[1]);
        case 'udp_send':
          return this.syscall_udp_send(args[0], args[1]);
        case 'draw':
          return this.syscall_draw(args[0], args[1]);
        case 'mkdir':
          return this.syscall_mkdir(args[0], args[1]);
        case 'readdir':
          return this.syscall_readdir(args[0]);
        case 'unlink':
          return this.syscall_unlink(args[0]);
        case 'rename':
          return this.syscall_rename(args[0], args[1]);
        case 'mount':
          return this.syscall_mount(args[0], args[1]);
        case 'unmount':
          return this.syscall_unmount(args[0]);
        case 'snapshot':
          return this.snapshot();
        case 'save_snapshot':
          persistKernelSnapshot(this.snapshot());
          return 0;
        default:
          throw new Error(`Unknown syscall: ${call}`);
      }
    };
  }

  // --- Syscall Implementations ---

  private syscall_open(pcb: ProcessControlBlock, path: string, flags: string): FileDescriptor {
    let node = this.state.fs.getNode(path);
    if (!node) {
      if (flags.includes('w') || flags.includes('a')) {
        const fsClone = this.state.fs.clone();
        node = fsClone.createFile(path, new Uint8Array(), 0o644);
        this.state.fs = fsClone;
      } else {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
    } else if (node.kind === 'dir') {
      throw new Error(`EISDIR: illegal operation on a directory, open '${path}'`);
    }

    const needsRead = flags.includes('r');
    const needsWrite = flags.includes('w') || flags.includes('a');
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
        throw new Error('EACCES: permission denied');
      }
      if (needsWrite && !(rights & 2)) {
        throw new Error('EACCES: permission denied');
      }
    }

    const fd = pcb.nextFd++;
    let position = 0;
    if (flags.includes('a') && node.data) {
      position = node.data.length;
    }
    pcb.fds.set(fd, { node, position, flags });
    return fd;
  }

  private syscall_read(pcb: ProcessControlBlock, fd: FileDescriptor, length: number): Uint8Array {
    const entry = pcb.fds.get(fd);
    if (!entry || entry.node.kind !== 'file' || !entry.node.data) {
      throw new Error('EBADF: bad file descriptor');
    }

    const data = entry.node.data.subarray(entry.position, entry.position + length);
    entry.position += data.length;
    return data;
  }

  private syscall_write(pcb: ProcessControlBlock, fd: FileDescriptor, data: Uint8Array): number {
    // For now, fd 1 (stdout) and 2 (stderr) write to the console.
    if (fd === 1 || fd === 2) {
      const text = new TextDecoder().decode(data);
      console.log(text);
      return data.length;
    }

    const entry = pcb.fds.get(fd);
    if (!entry || entry.node.kind !== 'file') {
      throw new Error('EBADF: bad file descriptor');
    }

    if (!entry.flags.includes('w') && !entry.flags.includes('a')) {
      throw new Error('EBADF: file not opened for writing');
    }

    const node = entry.node;
    const before = node.data ? node.data.slice(0, entry.position) : new Uint8Array();
    const after = node.data ? node.data.slice(entry.position + data.length) : new Uint8Array();
    const newData = new Uint8Array(before.length + data.length + after.length);
    newData.set(before, 0);
    newData.set(data, before.length);
    newData.set(after, before.length + data.length);
    const fsClone = this.state.fs.clone();
    const target = fsClone.getNode(node.path)!;
    target.data = newData;
    target.modifiedAt = new Date();
    entry.position += data.length;
    this.state.fs = fsClone;
    return data.length;
  }

  private syscall_close(pcb: ProcessControlBlock, fd: FileDescriptor): number {
    if (!pcb.fds.has(fd)) {
      return -1; // EBADF
    }
    pcb.fds.delete(fd);
    return 0;
  }

  private async syscall_spawn(code: string, opts: SpawnOpts = {}): Promise<number> {
    const pid = this.createProcess();
    const pcb = this.state.processes.get(pid)!;
    if (opts.uid !== undefined) pcb.uid = opts.uid;
    if (opts.gid !== undefined) pcb.gid = opts.gid;
    if (opts.quotaMs !== undefined) pcb.quotaMs = opts.quotaMs;
    if (opts.quotaMem !== undefined) pcb.quotaMem = opts.quotaMem;
    if (opts.syscalls) pcb.allowedSyscalls = new Set(opts.syscalls);
    pcb.code = code;
    pcb.argv = opts.argv ?? [];
    this.readyQueue.push(pcb);
    return pid;
  }

  private syscall_listen(port: number, proto: string, cb: ServiceHandler): number {
    if (proto === 'tcp') {
      return this.state.tcp.listen(port, cb);
    }
    if (proto === 'udp') {
      return this.state.udp.listen(port, cb);
    }
    throw new Error('Unsupported protocol');
  }

  private syscall_connect(ip: string, port: number): number {
    return this.state.tcp.connect(ip, port);
  }

  private async syscall_tcp_send(sock: number, data: Uint8Array) {
    return this.state.tcp.send(sock, data);
  }

  private async syscall_udp_send(sock: number, data: Uint8Array) {
    return this.state.udp.send(sock, data);
  }

  private syscall_draw(html: Uint8Array, opts: WindowOpts): number {
    const id = this.state.windows.length;
    const windows = this.state.windows.slice();
    windows.push({ html, opts });
    this.state = { ...this.state, windows };
    const payload = {
      id,
      html: new TextDecoder().decode(html),
      opts,
    };
    eventBus.emit('desktop.createWindow', payload);
    return id;
  }

  private syscall_mkdir(path: string, perms: number): number {
    const fsClone = this.state.fs.clone();
    fsClone.createDirectory(path, perms);
    this.state.fs = fsClone;
    return 0;
  }

  private syscall_readdir(path: string): FileSystemNode[] {
    return this.state.fs.listDirectory(path);
  }

  private syscall_unlink(path: string): number {
    const fsClone = this.state.fs.clone();
    fsClone.remove(path);
    this.state.fs = fsClone;
    return 0;
  }

  private syscall_rename(oldPath: string, newPath: string): number {
    const fsClone = this.state.fs.clone();
    fsClone.rename(oldPath, newPath);
    this.state.fs = fsClone;
    return 0;
  }

  private syscall_mount(image: FileSystemSnapshot, path: string): number {
    const fsClone = this.state.fs.clone();
    fsClone.mount(image, path);
    this.state.fs = fsClone;
    return 0;
  }

  private syscall_unmount(path: string): number {
    const fsClone = this.state.fs.clone();
    fsClone.unmount(path);
    this.state.fs = fsClone;
    return 0;
  }

  public snapshot(): Snapshot {
    const replacer = (_: string, value: any) => {
      if (value instanceof Map) {
        return { dataType: 'Map', value: Array.from(value.entries()) };
      }
      return value;
    };

    const fsSnapshot = this.state.fs.getSnapshot();
    const state: Snapshot = {
      fs: fsSnapshot,
      processes: this.state.processes,
      windows: this.state.windows,
      nextPid: this.state.nextPid,
      nics: this.state.nics,
      tcp: this.state.tcp,
      udp: this.state.udp,
      services: this.state.services,
    };

    return JSON.parse(JSON.stringify(state, replacer));
  }

  private async runProcess(pcb: ProcessControlBlock): Promise<void> {
    if (!pcb.code) return;
    const syscall = this.createSyscallDispatcher(pcb.pid);
    dispatcherMap.set(pcb.pid, syscall);
    const wrapped = `const main = ${pcb.code}; main(syscall, ${JSON.stringify(pcb.argv ?? [])});`;
    try {
      const exitCode = await invoke('run_isolate', {
        code: wrapped,
        quotaMs: pcb.quotaMs,
        quotaMem: pcb.quotaMem,
        pid: pcb.pid,
      });
      pcb.exitCode = exitCode ?? 0;
    } catch (e) {
      console.error('Process', pcb.pid, 'crashed or exceeded quota:', e);
      pcb.exitCode = 1;
    }
    dispatcherMap.delete(pcb.pid);
    pcb.exited = true;
  }

  public async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      const pcb = this.readyQueue.shift();
      if (!pcb) {
        await new Promise(r => setTimeout(r, 1));
        continue;
      }
      await this.runProcess(pcb);
      if (!pcb.exited) {
        this.readyQueue.push(pcb);
      }
    }
  }

  public stop(): void {
    persistKernelSnapshot(this.snapshot());
    this.running = false;
  }
}
