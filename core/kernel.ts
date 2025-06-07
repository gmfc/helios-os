// Helios-OS Kernel
// Implementation to follow based on the project roadmap. 

import { InMemoryFileSystem, FileSystemNode } from './fs';
import { loadSnapshot, createPersistHook } from './fs/sqlite';

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
  fds: Map<FileDescriptor, FileDescriptorEntry>;
  nextFd: FileDescriptor;
}

type Program = {
  main: (syscall: SyscallDispatcher, argv: string[]) => Promise<number>;
};

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

  private constructor(fs: InMemoryFileSystem) {
    this.fs = fs;
    this.processes = new Map();
    this.nextPid = 1;
  }

  public static async create(): Promise<Kernel> {
    const snapshot = await loadSnapshot();
    const fs = new InMemoryFileSystem(snapshot ?? undefined, createPersistHook());
    return new Kernel(fs);
  }

  public async spawn(command: string): Promise<number> {
    const [progName, ...argv] = command.split(' ').filter(Boolean);
    const path = `/bin/${progName}`; // Assume programs are in /bin

    let program: Program;
    try {
      const node = this.fs.getNode(path);
      if (!node || node.kind !== 'file' || !node.data) {
        throw new Error();
      }
      const source = new TextDecoder().decode(node.data);
      const mainFunc = new Function(`return ${source}`)();
      program = { main: mainFunc };
    } catch (e) {
      console.error(`-helios: ${progName}: command not found`);
      return 127;
    }

    const pid = this.createProcess();
    const syscallDispatcher = this.createSyscallDispatcher(pid);

    try {
      return await program.main(syscallDispatcher, argv);
    } catch (error) {
      console.error(`Process ${pid} (${progName}) crashed:`, error);
      return 1;
    } finally {
      this.cleanupProcess(pid);
    }
  }

  private createProcess(): ProcessID {
    const pid = this.nextPid++;
    const pcb: ProcessControlBlock = {
      pid,
      uid: 1000,
      gid: 1000,
      fds: new Map(),
      nextFd: 3, // 0, 1, 2 are reserved for stdio
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
}
