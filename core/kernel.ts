// Helios-OS Kernel
// Implementation to follow based on the project roadmap. 

import { InMemoryFileSystem, FileSystemNode } from './fs';
import {
  loadSnapshot,
  createPersistHook,
  loadKernelSnapshot,
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
export class Kernel {
  private fs: InMemoryFileSystem;
  private processes: Map<ProcessID, ProcessControlBlock>;
  private nextPid: ProcessID;
  private nics: Map<string, NIC>;
  private tcp: TCP;
  private udp: UDP;
  private windows: Array<{ html: Uint8Array; opts: WindowOpts }>;
  private services: Map<string, { port: number; proto: string }>;
  private readyQueue: ProcessControlBlock[];
  private running = false;

  private constructor(fs: InMemoryFileSystem) {
    this.fs = fs;
    this.processes = new Map();
    this.nextPid = 1;
    this.nics = new Map();
    this.tcp = new TCP();
    this.udp = new UDP();
    this.windows = [];
    this.services = new Map();
    this.readyQueue = [];
  }

  public static async create(): Promise<Kernel> {
    const full = await loadKernelSnapshot();
    if (full) {
      return Kernel.restore(full as Snapshot);
    }

    const snapshot = await loadSnapshot();
    const fs = new InMemoryFileSystem(snapshot ?? undefined, createPersistHook());
    const kernel = new Kernel(fs);
    const lo = new NIC('lo0', '00:00:00:00:00:00', '127.0.0.1');
    kernel.nics.set(lo.id, lo);
    listen('syscall', async (event: any) => {
      const { id, pid, call, args } = event.payload as any;
      const disp = dispatcherMap.get(pid);
      if (!disp) return;
      const result = await disp(call, ...args);
      await invoke('syscall_response', { id, result });
    });
    return kernel;
  }

  public static async restore(snapshot: Snapshot): Promise<Kernel> {
    const fs = new InMemoryFileSystem(snapshot.fs ?? undefined, createPersistHook());
    const kernel = new Kernel(fs);

    kernel.processes = new Map(snapshot.processes ?? []);
    kernel.nextPid = snapshot.nextPid ?? 1;
    kernel.windows = snapshot.windows ?? [];
    kernel.services = new Map(snapshot.services ?? []);

    kernel.nics = new Map();
    if (snapshot.nics) {
      for (const [id, nic] of snapshot.nics) {
        const n = new NIC(nic.id, nic.mac, nic.ip);
        n.rx = nic.rx ?? [];
        n.tx = nic.tx ?? [];
        kernel.nics.set(id, n);
      }
    }

    kernel.tcp = new TCP();
    if (snapshot.tcp) {
      (kernel.tcp as any).listeners = new Map(snapshot.tcp.listeners ?? []);
      (kernel.tcp as any).sockets = new Map(snapshot.tcp.sockets ?? []);
      (kernel.tcp as any).nextSocket = snapshot.tcp.nextSocket ?? 1;
    }

    kernel.udp = new UDP();
    if (snapshot.udp) {
      (kernel.udp as any).listeners = new Map(snapshot.udp.listeners ?? []);
      (kernel.udp as any).sockets = new Map(snapshot.udp.sockets ?? []);
      (kernel.udp as any).nextSocket = snapshot.udp.nextSocket ?? 1;
    }

    listen('syscall', async (event: any) => {
      const { id, pid, call, args } = event.payload as any;
      const disp = dispatcherMap.get(pid);
      if (!disp) return;
      const result = await disp(call, ...args);
      await invoke('syscall_response', { id, result });
    });

    kernel.readyQueue = Array.from(kernel.processes.values()).filter(p => !p.exited);

    return kernel;
  }

  public async spawn(command: string, opts: SpawnOpts = {}): Promise<number> {
    const [progName, ...argv] = command.split(' ').filter(Boolean);
    const path = `/bin/${progName}`; // Assume programs are in /bin
    const manifestPath = `/bin/${progName}.manifest.json`;

    let source: string;
    try {
      const node = this.fs.getNode(path);
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
      const mnode = this.fs.getNode(manifestPath);
      if (mnode && mnode.kind === 'file' && mnode.data) {
        const { syscalls } = JSON.parse(new TextDecoder().decode(mnode.data));
        if (Array.isArray(syscalls)) manifestSyscalls = syscalls;
      }
    } catch {}

    return this.syscall_spawn(source, { argv, syscalls: manifestSyscalls, ...opts });
  }

  public registerService(name: string, port: number, proto: string, handler: ServiceHandler): void {
    this.syscall_listen(port, proto, handler);
    this.services.set(name, { port, proto });
  }

  public stopService(name: string): void {
    const svc = this.services.get(name);
    if (!svc) return;
    if (svc.proto === 'tcp') {
      this.tcp.unlisten(svc.port);
    } else if (svc.proto === 'udp') {
      this.udp.unlisten(svc.port);
    }
    this.services.delete(name);
  }

  private createProcess(): ProcessID {
    const pid = this.nextPid++;
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
    this.processes.set(pid, pcb);
    return pid;
  }

  private cleanupProcess(pid: ProcessID) {
    this.processes.delete(pid);
  }

  private createSyscallDispatcher(pid: ProcessID): SyscallDispatcher {
    return async (call: string, ...args: any[]): Promise<any> => {
      const pcb = this.processes.get(pid);
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
        case 'draw':
          return this.syscall_draw(args[0], args[1]);
        case 'snapshot':
          return this.snapshot();
        default:
          throw new Error(`Unknown syscall: ${call}`);
      }
    };
  }

  // --- Syscall Implementations ---

  private syscall_open(pcb: ProcessControlBlock, path: string, flags: string): FileDescriptor {
    let node = this.fs.getNode(path);
    if (!node) {
      if (flags.includes('w') || flags.includes('a')) {
        node = this.fs.createFile(path, new Uint8Array(), 0o644);
      } else {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
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
    node.data = newData;
    entry.position += data.length;
    node.modifiedAt = new Date();
    this.fs.writeFile(node.path, node.data);
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
    const pcb = this.processes.get(pid)!;
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
      return this.tcp.listen(port, cb);
    }
    if (proto === 'udp') {
      return this.udp.listen(port, cb);
    }
    throw new Error('Unsupported protocol');
  }

  private syscall_connect(ip: string, port: number): number {
    return this.tcp.connect(ip, port);
  }

  private syscall_draw(html: Uint8Array, opts: WindowOpts): number {
    const id = this.windows.length;
    this.windows.push({ html, opts });
    const payload = {
      id,
      html: new TextDecoder().decode(html),
      opts,
    };
    eventBus.emit('draw', payload);
    return id;
  }

  public snapshot(): Snapshot {
    const replacer = (_: string, value: any) => {
      if (value instanceof Map) {
        return { dataType: 'Map', value: Array.from(value.entries()) };
      }
      return value;
    };

    const fsSnapshot = this.fs.getSnapshot();
    const state: Snapshot = {
      fs: fsSnapshot,
      processes: this.processes,
      windows: this.windows,
      nextPid: this.nextPid,
      nics: this.nics,
      tcp: this.tcp,
      udp: this.udp,
      services: this.services,
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
}
