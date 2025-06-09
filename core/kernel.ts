// Helios-OS Kernel
// Implementation to follow based on the project roadmap. 

import { InMemoryFileSystem, FileSystemNode, FileSystemSnapshot, loadFileSystem } from './fs';
import { bootstrapFileSystem } from './fs/pure';
import {
  createPersistHook,
  loadKernelSnapshot,
  persistKernelSnapshot,
  saveNamedSnapshot,
  loadNamedSnapshot,
} from './fs/sqlite';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { eventBus } from './eventBus';
import { NIC } from './net/nic';
import { TCP } from './net/tcp';
import { UDP } from './net/udp';
import { BASH_SOURCE } from './fs/bin';
import { startHttpd, startSshd, startPingService } from './services';

type ProcessID = number;
type FileDescriptor = number;

/**
 * Represents a single entry in a process's file descriptor table.
 */
interface FileDescriptorEntry {
  path: string;
  position: number;
  flags: string; // e.g., 'r', 'w', 'rw'
  virtual?: boolean;
}

/**
 * Process Control Block: Stores the state of a single process.
 */
interface ProcessControlBlock {
  pid: ProcessID;
  isolateId: number;
  uid: number;
  gid: number;
  quotaMs: number;
  quotaMem: number;
    cpuMs: number;
    memBytes: number;
    tty?: string;
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
  fs: any;
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
  private initPid: ProcessID | null = null;
  private pendingNics: Array<any> | null = null;
  private networkingStarted = false;
  private jobs: Map<number, { id: number; pids: number[]; command: string; status: string }> = new Map();
  private nextJob = 1;

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

    const fs = (await loadFileSystem()) ?? bootstrapFileSystem();
    const kernel = new Kernel(fs);
    kernel.pendingNics = [
      { id: 'lo0', mac: '00:00:00:00:00:00', ip: '127.0.0.1', rx: [], tx: [] }
    ];
    if (typeof window !== 'undefined') {
      listen('syscall', async (event: any) => {
        const { id, pid, call, args } = event.payload as any;
        const disp = dispatcherMap.get(pid);
        if (!disp) return;
        const result = await disp(call, ...args);
        await invoke('syscall_response', { id, result });
      });
    }
    try {
      const node = fs.getNode('/sbin/init');
      if (node && node.kind === 'file' && node.data) {
        const code = new TextDecoder().decode(node.data);
        let syscalls: string[] | undefined;
        const m = fs.getNode('/sbin/init.manifest.json');
        if (m && m.kind === 'file' && m.data) {
          const parsed = JSON.parse(new TextDecoder().decode(m.data));
          if (Array.isArray(parsed.syscalls)) syscalls = parsed.syscalls;
        }
        kernel.initPid = await kernel.syscall_spawn(code, { syscalls });
      }
    } catch (e) {
      console.error('Failed to spawn init:', e);
    }
    return kernel;
  }

  public static async restore(snapshot: Snapshot): Promise<Kernel> {
    const reviver = (_: string, value: any) => {
      if (value && typeof value === 'object') {
        if (value.dataType === 'Map') {
          return new Map(value.value);
        }
        if (value.dataType === 'Set') {
          return new Set<string>(value.value);
        }
        if (value.dataType === 'Uint8Array') {
          if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(value.value, 'base64'));
          }
          const bin = atob(value.value);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return arr;
        }
        if (value.dataType === 'NIC') {
          const nic = new NIC(value.id, value.mac, value.ip);
          nic.rx = value.rx ?? [];
          nic.tx = value.tx ?? [];
          return nic;
        }
        if (value.dataType === 'TCP') {
          const tcp = new TCP();
          (tcp as any).listeners = new Map(value.listeners ?? []);
          (tcp as any).sockets = new Map(value.sockets ?? []);
          (tcp as any).nextSocket = value.nextSocket ?? 1;
          return tcp;
        }
        if (value.dataType === 'UDP') {
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

    const fs = new InMemoryFileSystem(snapshot.fs ?? undefined, createPersistHook());
    const kernel = new Kernel(fs);
    kernel.state.processes = new Map(parsed.processes ?? []);
    kernel.state.nextPid = parsed.nextPid ?? 1;
    kernel.state.windows = parsed.windows ?? [];
    for (const [id, win] of kernel.state.windows.entries()) {
        eventBus.emit('desktop.createWindow', {
            id,
            html: new TextDecoder().decode(win.html),
            opts: win.opts,
        });
    }
    kernel.state.services = new Map(parsed.services ?? []);
    kernel.initPid = parsed.initPid ?? null;

    kernel.pendingNics = parsed.nics ? Array.from(parsed.nics.values()) : [];

    kernel.state.tcp = parsed.tcp instanceof TCP ? parsed.tcp : new TCP();

    kernel.state.udp = parsed.udp instanceof UDP ? parsed.udp : new UDP();

    for (const [name, svc] of kernel.state.services.entries()) {
      if (name.startsWith('httpd')) {
        startHttpd(kernel, { port: svc.port });
      } else if (name.startsWith('sshd')) {
        startSshd(kernel, { port: svc.port });
      } else if (name.startsWith('pingd')) {
        startPingService(kernel, { port: svc.port });
      }
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

  public startNetworking(): void {
    if (this.networkingStarted) return;
    this.networkingStarted = true;
    this.state.nics = new Map();
    const list = this.pendingNics ?? [];
    if (list.length === 0) {
      list.push({ id: 'lo0', mac: '00:00:00:00:00:00', ip: '127.0.0.1', rx: [], tx: [] });
    }
    for (const [, nic] of list.entries()) {
      const n = new NIC(nic.id, nic.mac, nic.ip);
      n.rx = nic.rx ?? [];
      n.tx = nic.tx ?? [];
      this.state.nics.set(n.id, n);
    }
    this.pendingNics = null;
  }

  private createProcess(): ProcessID {
    const pid = this.state.nextPid++;
    const pcb: ProcessControlBlock = {
        pid,
        isolateId: pid,
        uid: 1000,
        gid: 1000,
        quotaMs: 10,
        quotaMem: 8 * 1024 * 1024,
        cpuMs: 0,
        memBytes: 0,
        tty: undefined,
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
          return await this.syscall_open(pcb, args[0], args[1]);
        case 'read':
          return await this.syscall_read(pcb, args[0], args[1]);
        case 'write':
          return await this.syscall_write(pcb, args[0], args[1]);
        case 'close':
          return await this.syscall_close(pcb, args[0]);
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
          return await this.syscall_mkdir(args[0], args[1]);
        case 'readdir':
          return await this.syscall_readdir(args[0]);
        case 'unlink':
          return await this.syscall_unlink(args[0]);
        case 'rename':
          return await this.syscall_rename(args[0], args[1]);
        case 'mount':
          return await this.syscall_mount(args[0], args[1]);
        case 'unmount':
          return await this.syscall_unmount(args[0]);
        case 'snapshot':
          return this.snapshot();
        case 'save_snapshot':
          persistKernelSnapshot(this.snapshot());
          return 0;
        case 'save_snapshot_named':
          await saveNamedSnapshot(args[0], this.snapshot());
          return 0;
        case 'load_snapshot_named': {
          const snap = await loadNamedSnapshot(args[0]);
          if (!snap) return -1;
          this.running = false;
          persistKernelSnapshot(snap);
          eventBus.emit('system.reboot', {});
          return 0;
        }
        case 'ps':
          return this.syscall_ps();
        case 'jobs':
          return this.syscall_jobs();
        case 'reboot':
          return this.reboot();
        default:
          throw new Error(`Unknown syscall: ${call}`);
      }
    };
  }

  // --- Syscall Implementations ---

  private async syscall_open(pcb: ProcessControlBlock, path: string, flags: string): Promise<FileDescriptor> {
    if (this.isProcPath(path)) {
      const parts = path.split('/').filter(p => p);
      if (parts.length < 3) {
        throw new Error(`EISDIR: illegal operation on a directory, open '${path}'`);
      }

      const pid = parseInt(parts[1], 10);
      const target = this.state.processes.get(pid);
      if (!target) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }

      if (parts[2] === 'status' && parts.length === 3) {
        // valid
      } else if (parts[2] === 'fd' && parts.length === 4) {
        const vfd = parseInt(parts[3], 10);
        if (!target.fds.has(vfd)) {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }
      } else {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }

      const fd = pcb.nextFd++;
      pcb.fds.set(fd, { path, position: 0, flags, virtual: true });
      return fd;
    }

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
    pcb.fds.set(fd, { path, position, flags });
    return fd;
  }

  private async syscall_read(pcb: ProcessControlBlock, fd: FileDescriptor, length: number): Promise<Uint8Array> {
    const entry = pcb.fds.get(fd);
    if (!entry) {
      throw new Error('EBADF: bad file descriptor');
    }
    if (entry.virtual) {
      const data = this.procReadFile(entry.path).subarray(entry.position, entry.position + length);
      entry.position += data.length;
      return data;
    }

    const node = this.state.fs.getNode(entry.path);
    if (!node || node.kind !== 'file' || !node.data) {
      throw new Error('EBADF: bad file descriptor');
    }

    const data = node.data.subarray(entry.position, entry.position + length);
    entry.position += data.length;
    return data;
  }

  private async syscall_write(pcb: ProcessControlBlock, fd: FileDescriptor, data: Uint8Array): Promise<number> {
    // For now, fd 1 (stdout) and 2 (stderr) write to the console.
    if (fd === 1 || fd === 2) {
      const text = new TextDecoder().decode(data);
      console.log(text);
      return data.length;
    }

    const entry = pcb.fds.get(fd);
    if (!entry) {
      throw new Error('EBADF: bad file descriptor');
    }

    if (entry.virtual) {
      throw new Error('EBADF: file not opened for writing');
    }

    const node = this.state.fs.getNode(entry.path);
    if (!node || node.kind !== 'file') {
      throw new Error('EBADF: bad file descriptor');
    }

    if (!entry.flags.includes('w') && !entry.flags.includes('a')) {
      throw new Error('EBADF: file not opened for writing');
    }

    const before = node.data ? node.data.slice(0, entry.position) : new Uint8Array();
    const after = node.data ? node.data.slice(entry.position + data.length) : new Uint8Array();
    const newData = new Uint8Array(before.length + data.length + after.length);
    newData.set(before, 0);
    newData.set(data, before.length);
    newData.set(after, before.length + data.length);
    const fsClone = this.state.fs.clone();
    const target = fsClone.getNode(entry.path)!;
    target.data = newData;
    target.modifiedAt = new Date();
    entry.position += data.length;
    this.state.fs = fsClone;
    return data.length;
  }

  private async syscall_close(pcb: ProcessControlBlock, fd: FileDescriptor): Promise<number> {
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
    pcb.cpuMs = 0;
    pcb.memBytes = 0;
    pcb.isolateId = pid;
    if (opts.tty !== undefined) pcb.tty = opts.tty;
    if (opts.syscalls) pcb.allowedSyscalls = new Set(opts.syscalls);
    pcb.code = code;
    pcb.argv = opts.argv ?? [];
    this.readyQueue.push(pcb);
    if (code === BASH_SOURCE) {
      eventBus.emit('boot.shellReady', { pid });
    }
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

  // --- /proc helpers ---
  private isProcPath(path: string): boolean {
    return path === '/proc' || path.startsWith('/proc/');
  }

  private procReaddir(path: string): FileSystemNode[] {
    const parts = path.split('/').filter(p => p);
    const now = new Date();

    if (path === '/proc') {
      return Array.from(this.state.processes.keys()).map(pid => ({
        path: `/proc/${pid}`,
        kind: 'dir',
        permissions: 0o555,
        uid: 0,
        gid: 0,
        createdAt: now,
        modifiedAt: now,
      }));
    }

    if (parts.length === 2) {
      const pid = parseInt(parts[1], 10);
      const pcb = this.state.processes.get(pid);
      if (!pcb) throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      return [
        {
          path: `/proc/${pid}/status`,
          kind: 'file',
          permissions: 0o444,
          uid: 0,
          gid: 0,
          createdAt: now,
          modifiedAt: now,
        },
        {
          path: `/proc/${pid}/fd`,
          kind: 'dir',
          permissions: 0o555,
          uid: 0,
          gid: 0,
          createdAt: now,
          modifiedAt: now,
        },
      ];
    }

    if (parts.length === 3 && parts[2] === 'fd') {
      const pid = parseInt(parts[1], 10);
      const pcb = this.state.processes.get(pid);
      if (!pcb) throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      return Array.from(pcb.fds.keys()).map(fd => ({
        path: `/proc/${pid}/fd/${fd}`,
        kind: 'file',
        permissions: 0o444,
        uid: 0,
        gid: 0,
        createdAt: now,
        modifiedAt: now,
      }));
    }

    throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
  }

  private procReadFile(path: string): Uint8Array {
    const parts = path.split('/').filter(p => p);
    const enc = new TextEncoder();

    if (parts.length === 3 && parts[2] === 'status') {
      const pid = parseInt(parts[1], 10);
      const pcb = this.state.processes.get(pid);
      if (!pcb) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      const cmd = pcb.argv ? pcb.argv.join(' ') : '';
      const out =
        `pid:\t${pid}\nuid:\t${pcb.uid}\n` +
        `cpuMs:\t${pcb.cpuMs}\nmemBytes:\t${pcb.memBytes}\n` +
        `tty:\t${pcb.tty ?? ''}\ncmd:\t${cmd}\n`;
      return enc.encode(out);
    }

    if (parts.length === 4 && parts[2] === 'fd') {
      const pid = parseInt(parts[1], 10);
      const fd = parseInt(parts[3], 10);
      const pcb = this.state.processes.get(pid);
      const entry = pcb?.fds.get(fd);
      if (!pcb || !entry) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return enc.encode(entry.path);
    }

    throw new Error(`ENOENT: no such file or directory, open '${path}'`);
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

  private async syscall_mkdir(path: string, perms: number): Promise<number> {
    const fsClone = this.state.fs.clone();
    fsClone.createDirectory(path, perms);
    this.state.fs = fsClone;
    return 0;
  }

  private async syscall_readdir(path: string): Promise<FileSystemNode[]> {
    if (this.isProcPath(path)) {
      return this.procReaddir(path);
    }
    return this.state.fs.listDirectory(path);
  }

  private async syscall_unlink(path: string): Promise<number> {
    const fsClone = this.state.fs.clone();
    fsClone.remove(path);
    this.state.fs = fsClone;
    return 0;
  }

  private async syscall_rename(oldPath: string, newPath: string): Promise<number> {
    const fsClone = this.state.fs.clone();
    fsClone.rename(oldPath, newPath);
    this.state.fs = fsClone;
    return 0;
  }

  private async syscall_mount(image: FileSystemSnapshot, path: string): Promise<number> {
    const fsClone = this.state.fs.clone();
    fsClone.mount(image, path);
    this.state.fs = fsClone;
    return 0;
  }

  private async syscall_unmount(path: string): Promise<number> {
    const fsClone = this.state.fs.clone();
    fsClone.unmount(path);
    this.state.fs = fsClone;
    return 0;
  }

  private syscall_ps() {
    const list: Array<{ pid: number; argv?: string[]; exited?: boolean; cpuMs: number; memBytes: number; tty?: string }> = [];
    for (const [pid, pcb] of this.state.processes.entries()) {
        list.push({ pid, argv: pcb.argv, exited: pcb.exited, cpuMs: pcb.cpuMs, memBytes: pcb.memBytes, tty: pcb.tty });
    }
    return list;
  }

  private syscall_jobs() {
    return Array.from(this.jobs.values());
  }

  public registerJob(pids: number[], command: string): number {
    const id = this.nextJob++;
    const jobs = new Map(this.jobs);
    const entry = { id, pids, command, status: 'Running' };
    jobs.set(id, entry);
    this.jobs = jobs;
    return id;
  }

  public removeJob(id: number): void {
    const jobs = new Map(this.jobs);
    jobs.delete(id);
    this.jobs = jobs;
  }

  public updateJobStatus(id: number, status: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const jobs = new Map(this.jobs);
    jobs.set(id, { ...job, status });
    this.jobs = jobs;
  }

  public snapshot(): Snapshot {
    const replacer = (_: string, value: any) => {
      if (value instanceof Map) {
        return { dataType: 'Map', value: Array.from(value.entries()) };
      }
      if (value instanceof Set) {
        return { dataType: 'Set', value: Array.from(value) };
      }
      if (value instanceof Uint8Array) {
        const str = typeof Buffer !== 'undefined'
          ? Buffer.from(value).toString('base64')
          : btoa(String.fromCharCode(...Array.from(value)));
        return { dataType: 'Uint8Array', value: str };
      }
      if (value instanceof NIC) {
        return {
          dataType: 'NIC',
          id: value.id,
          mac: value.mac,
          ip: value.ip,
          rx: value.rx,
          tx: value.tx,
        };
      }
      if (value instanceof TCP) {
        return {
          dataType: 'TCP',
          listeners: Array.from((value as any).listeners.entries()),
          sockets: Array.from((value as any).sockets.entries()),
          nextSocket: (value as any).nextSocket,
        };
      }
      if (value instanceof UDP) {
        return {
          dataType: 'UDP',
          listeners: Array.from((value as any).listeners.entries()),
          sockets: Array.from((value as any).sockets.entries()),
          nextSocket: (value as any).nextSocket,
        };
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
      initPid: this.initPid,
    };

    return JSON.parse(JSON.stringify(state, replacer));
  }

  private async runProcess(pcb: ProcessControlBlock): Promise<void> {
    if (!pcb.code) return;
    const syscall = this.createSyscallDispatcher(pcb.pid);
    dispatcherMap.set(pcb.pid, syscall);
    const wrapped = `const main = ${pcb.code}; main(syscall, ${JSON.stringify(pcb.argv ?? [])});`;
    try {
        const result: any = await invoke('run_isolate_slice', {
            pid: pcb.isolateId,
            code: wrapped,
            sliceMs: pcb.quotaMs,
            quotaMem: pcb.quotaMem,
        });
        if (result) {
            pcb.cpuMs += result.cpu_ms ?? 0;
            pcb.memBytes += result.mem_bytes ?? 0;
            if (!result.running) {
                pcb.exitCode = result.exit_code ?? 0;
                pcb.exited = true;
            }
        } else {
            pcb.exitCode = 0;
            pcb.exited = true;
        }
    } catch (e) {
      console.error('Process', pcb.pid, 'crashed or exceeded quota:', e);
      pcb.exitCode = 1;
      pcb.exited = true;
    }
    dispatcherMap.delete(pcb.pid);
  }

  public async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      const queue = this.readyQueue.slice();
      this.readyQueue = [];
      if (queue.length === 0) {
        await new Promise(r => setTimeout(r, 1));
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

  public stop(): void {
    persistKernelSnapshot(this.snapshot());
    this.running = false;
  }

  public reboot(): void {
    this.stop();
    eventBus.emit('system.reboot', {});
  }
}
