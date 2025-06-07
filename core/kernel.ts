// Helios-OS Kernel
// Implementation to follow based on the project roadmap. 

import { InMemoryFileSystem, FileSystemNode } from './fs';
import { loadSnapshot, createPersistHook } from './fs/sqlite';
import { invoke } from '@tauri-apps/api/tauri';

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
}

export type ServiceHandler = (data: Uint8Array) => Promise<Uint8Array | void>;

export interface WindowOpts {
  title?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

/**
 * A function that dispatches a syscall to the kernel for a specific process.
 */
export type SyscallDispatcher = (call: string, ...args: any[]) => Promise<any>;

/**
 * The Helios-OS Kernel, responsible for process, file, and system management.
 */
export class Kernel {
  private fs: InMemoryFileSystem;
  private processes: Map<ProcessID, ProcessControlBlock>;
  private nextPid: ProcessID;
  private services: Map<number, { proto: string; handler: ServiceHandler }>;
  private sockets: Map<number, { ip: string; port: number }>;
  private nextSocketId: number;
  private windows: Array<{ html: Uint8Array; opts: WindowOpts }>;
  private readyQueue: ProcessControlBlock[];
  private running = false;

  private constructor(fs: InMemoryFileSystem) {
    this.fs = fs;
    this.processes = new Map();
    this.nextPid = 1;
    this.services = new Map();
    this.sockets = new Map();
    this.nextSocketId = 1;
    this.windows = [];
    this.readyQueue = [];
  }

  public static async create(): Promise<Kernel> {
    const snapshot = await loadSnapshot();
    const fs = new InMemoryFileSystem(snapshot ?? undefined, createPersistHook());
    return new Kernel(fs);
  }

  public async spawn(command: string, opts: SpawnOpts = {}): Promise<number> {
    const [progName, ...argv] = command.split(' ').filter(Boolean);
    const path = `/bin/${progName}`; // Assume programs are in /bin

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

    return this.syscall_spawn(source, { argv, ...opts });
  }

  private createProcess(): ProcessID {
    const pid = this.nextPid++;
    const pcb: ProcessControlBlock = {
      pid,
      uid: 1000,
      gid: 1000,
      quotaMs: 10,
      quotaMem: 8 * 1024 * 1024,
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
          return this.syscall_snapshot();
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
    pcb.code = code;
    pcb.argv = opts.argv ?? [];
    this.readyQueue.push(pcb);
    return pid;
  }

  private syscall_listen(port: number, proto: string, cb: ServiceHandler): number {
    this.services.set(port, { proto, handler: cb });
    return port;
  }

  private syscall_connect(ip: string, port: number): number {
    const id = this.nextSocketId++;
    this.sockets.set(id, { ip, port });
    return id;
  }

  private syscall_draw(html: Uint8Array, opts: WindowOpts): number {
    this.windows.push({ html, opts });
    return this.windows.length - 1;
  }

  private syscall_snapshot(): any {
    const replacer = (_: string, value: any) => {
      if (value instanceof Map) {
        return { dataType: 'Map', value: Array.from(value.entries()) };
      }
      return value;
    };

    const fsSnapshot = (this.fs as any).serialize();
    const state = {
      fs: fsSnapshot,
      processes: this.processes,
      services: this.services,
      sockets: this.sockets,
      windows: this.windows,
      nextPid: this.nextPid,
      nextSocketId: this.nextSocketId,
    };
    return JSON.parse(JSON.stringify(state, replacer));
  }

  private async runProcess(pcb: ProcessControlBlock): Promise<void> {
    if (!pcb.code) return;
    const wrapped = `const main = ${pcb.code}; main(() => Promise.resolve(0), ${JSON.stringify(pcb.argv ?? [])});`;
    try {
      const exitCode = await invoke('run_isolate', {
        code: wrapped,
        quotaMs: pcb.quotaMs,
        quotaMem: pcb.quotaMem,
      });
      pcb.exitCode = exitCode ?? 0;
    } catch (e) {
      console.error('Process', pcb.pid, 'crashed:', e);
      pcb.exitCode = 1;
    }
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
