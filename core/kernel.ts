// Helios-OS Kernel
// Implementation to follow based on the project roadmap. 

import { InMemoryFileSystem, FileSystemNode, FileSystemSnapshot, loadFileSystem } from './fs';
import type { AsyncFileSystem } from './fs/async';
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
  quotaMs_total: number;
  quotaMem: number;
    cpuMs: number;
    memBytes: number;
    tty?: string;
  started: boolean;
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
 * A function that dispatches a syscall to the kernel for a specific process.
 */
export type SyscallDispatcher = (call: string, ...args: any[]) => Promise<any>;

const dispatcherMap: Map<ProcessID, SyscallDispatcher> = new Map();

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
  private jobs: Map<number, { id: number; pids: number[]; command: string; status: string }> = new Map();
  private nextJob = 1;

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
      const initData = await fs.read('/sbin/init');
      const code = new TextDecoder().decode(initData);
      let syscalls: string[] | undefined;
      try {
        const mdata = await fs.read('/sbin/init.manifest.json');
        const parsed = JSON.parse(new TextDecoder().decode(mdata));
        if (Array.isArray(parsed.syscalls)) syscalls = parsed.syscalls;
      } catch {}
      kernel.initPid = await kernel.syscall_spawn(code, { syscalls });
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

    const fs: AsyncFileSystem = snapshot.fs
      ? new InMemoryFileSystem(snapshot.fs, createPersistHook())
      : (await loadFileSystem()) ?? bootstrapFileSystem();
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

    for (const pid of kernel.state.processes.keys()) {
      kernel.registerProc(pid);
      const pcb = kernel.state.processes.get(pid)!;
      if (pcb.quotaMs_total === undefined) pcb.quotaMs_total = Infinity;
      if (pcb.started === undefined) pcb.started = false;
      for (const fd of pcb.fds.keys()) {
        kernel.registerProcFd(pid, fd);
      }
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
        quotaMs_total: Infinity,
        quotaMem: 8 * 1024 * 1024,
        cpuMs: 0,
        memBytes: 0,
        tty: undefined,
        started: false,
        allowedSyscalls: undefined,
        fds: new Map(),
        nextFd: 3, // 0, 1, 2 are reserved for stdio
        exited: false,
    };
    const processes = new Map(this.state.processes);
    processes.set(pid, pcb);
    this.state = { ...this.state, processes };
    this.registerProc(pid);
    return pid;
  }

  private cleanupProcess(pid: ProcessID) {
    const processes = new Map(this.state.processes);
    processes.delete(pid);
    this.state = { ...this.state, processes };
  }

  private ensureProcRoot() {
    if (!(this.state.fs as any).getNode('/proc')) {
      (this.state.fs as any).createVirtualDirectory('/proc', 0o555);
    }
  }

  private registerProc(pid: ProcessID) {
    this.ensureProcRoot();
    if (!(this.state.fs as any).getNode(`/proc/${pid}`)) {
      (this.state.fs as any).createVirtualDirectory(`/proc/${pid}`, 0o555);
    }
    if (!(this.state.fs as any).getNode(`/proc/${pid}/status`)) {
      (this.state.fs as any).createVirtualFile(`/proc/${pid}/status`, () => this.procStatus(pid), 0o444);
    }
    if (!(this.state.fs as any).getNode(`/proc/${pid}/fd`)) {
      (this.state.fs as any).createVirtualDirectory(`/proc/${pid}/fd`, 0o555);
    }
  }

  private registerProcFd(pid: ProcessID, fd: number) {
    const pcb = this.state.processes.get(pid);
    if (!pcb) return;
    if (!(this.state.fs as any).getNode(`/proc/${pid}/fd/${fd}`)) {
      (this.state.fs as any).createVirtualFile(`/proc/${pid}/fd/${fd}`, () => {
        const entry = pcb.fds.get(fd);
        return new TextEncoder().encode(entry ? entry.path : '');
      }, 0o444);
    }
  }

  private removeProcFd(pid: ProcessID, fd: number) {
    const path = `/proc/${pid}/fd/${fd}`;
    if ((this.state.fs as any).getNode(path)) {
      (this.state.fs as any).remove(path);
    }
  }

  private procStatus(pid: ProcessID): Uint8Array {
    const pcb = this.state.processes.get(pid);
    if (!pcb) return new Uint8Array();
    const enc = new TextEncoder();
    const cmd = pcb.argv ? pcb.argv.join(' ') : '';
    const out =
      `pid:\t${pid}\nuid:\t${pcb.uid}\n` +
      `cpuMs:\t${pcb.cpuMs}\nmemBytes:\t${pcb.memBytes}\n` +
      `tty:\t${pcb.tty ?? ''}\ncmd:\t${cmd}\n`;
    return enc.encode(out);
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
        case 'set_quota':
          return this.syscall_set_quota(pcb, args[0], args[1]);
        case 'kill':
          return this.syscall_kill(args[0], args[1]);
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

    const node = await this.state.fs.open(path, flags);
    if (node.kind === 'dir') {
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
    if (flags.includes('a')) {
      const data = await this.state.fs.read(path);
      position = data.length;
    }
    pcb.fds.set(fd, { path, position, flags, virtual: (node as any).virtual });
    this.registerProcFd(pcb.pid, fd);
    return fd;
  }

  private async syscall_read(pcb: ProcessControlBlock, fd: FileDescriptor, length: number): Promise<Uint8Array> {
    const entry = pcb.fds.get(fd);
    if (!entry) {
      throw new Error('EBADF: bad file descriptor');
    }

    const data = await this.state.fs.read(entry.path);
    const bytes = data.subarray(entry.position, entry.position + length);
    entry.position += bytes.length;
    return bytes;
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

    if (!entry.flags.includes('w') && !entry.flags.includes('a')) {
      throw new Error('EBADF: file not opened for writing');
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

  private async syscall_close(pcb: ProcessControlBlock, fd: FileDescriptor): Promise<number> {
    if (!pcb.fds.has(fd)) {
      return -1; // EBADF
    }
    pcb.fds.delete(fd);
    this.removeProcFd(pcb.pid, fd);
    return 0;
  }

  private async syscall_spawn(code: string, opts: SpawnOpts = {}): Promise<number> {
    const pid = this.createProcess();
    const pcb = this.state.processes.get(pid)!;
    if (opts.uid !== undefined) pcb.uid = opts.uid;
    if (opts.gid !== undefined) pcb.gid = opts.gid;
    if (opts.quotaMs !== undefined) pcb.quotaMs = opts.quotaMs;
    if (opts.quotaMs_total !== undefined) pcb.quotaMs_total = opts.quotaMs_total;
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
      eventBus.emit('boot.shellReady', { pid });
    }
    return pid;
  }

  private syscall_kill(pid: number, sig?: number): number {
      const pcb = this.state.processes.get(pid);
      if (!pcb || pid === this.initPid) {
          return -1;
      }
      pcb.exited = true;
      pcb.exitCode = sig ?? 9;
        invoke('drop_isolate', { pid: pcb.isolateId }).catch(() => {});
      this.readyQueue = this.readyQueue.filter(p => p.pid !== pid);
      for (const [id, job] of this.jobs.entries()) {
          if (job.pids.includes(pid)) {
              this.updateJobStatus(id, 'Killed');
          }
      }
      return 0;
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

  private async syscall_mkdir(path: string, perms: number): Promise<number> {
    await this.state.fs.mkdir(path, perms);
    return 0;
  }

  private async syscall_readdir(path: string): Promise<FileSystemNode[]> {
    return this.state.fs.readdir(path);
  }

  private async syscall_unlink(path: string): Promise<number> {
    await this.state.fs.unlink(path);
    return 0;
  }

  private async syscall_rename(oldPath: string, newPath: string): Promise<number> {
    await this.state.fs.rename(oldPath, newPath);
    return 0;
  }

  private async syscall_mount(image: FileSystemSnapshot, path: string): Promise<number> {
    await this.state.fs.mount(image, path);
    return 0;
  }

  private async syscall_unmount(path: string): Promise<number> {
    await this.state.fs.unmount(path);
    return 0;
  }

  private syscall_set_quota(pcb: ProcessControlBlock, ms?: number, mem?: number) {
    if (typeof ms === 'number' && !isNaN(ms)) {
      pcb.quotaMs = ms;
    }
    if (typeof mem === 'number' && !isNaN(mem)) {
      pcb.quotaMem = mem;
    }
    return { quotaMs: pcb.quotaMs, quotaMem: pcb.quotaMem };
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

  private async runProcess(pcb: ProcessControlBlock): Promise<void> {
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
        const result: any = await invoke('run_isolate_slice', args);
        if (!pcb.started) {
            pcb.started = true;
            pcb.code = undefined;
        }
        if (result) {
            pcb.cpuMs += result.cpu_ms ?? 0;
            pcb.memBytes += result.mem_bytes ?? 0;
            if (pcb.cpuMs > pcb.quotaMs_total || pcb.memBytes > pcb.quotaMem) {
                console.warn('Process', pcb.pid, 'exceeded quota');
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
      console.error('Process', pcb.pid, 'crashed or exceeded quota:', e);
      pcb.exitCode = 1;
      pcb.exited = true;
    }
    if (pcb.exited) {
      try {
        await invoke('drop_isolate', { pid: pcb.isolateId });
      } catch {}
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
    eventBus.emit('system.reboot', {});
  }
}
