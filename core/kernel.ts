// Helios-OS Kernel
// Implementation to follow based on the project roadmap. 

import { InMemoryFileSystem, FileSystemNode } from './fs';

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

/**
 * Defines the interface for a program that can be run by the kernel.
 */
export interface Program {
  main: (syscall: SyscallDispatcher, argv: string[]) => Promise<number>;
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
  private programs: Map<string, Program>;

  constructor() {
    this.fs = new InMemoryFileSystem();
    this.processes = new Map();
    this.nextPid = 1;
    this.programs = new Map();
  }

  /**
   * Registers a program with the kernel so it can be spawned.
   * @param name The name of the program (e.g., 'cat').
   * @param program The program implementation.
   */
  public registerProgram(name: string, program: Program) {
    this.programs.set(name, program);
  }

  /**
   * Spawns a new process to run a program.
   * @param command The command to run, including arguments (e.g., 'cat /etc/issue').
   * @returns The exit code of the process.
   */
  public async spawn(command: string): Promise<number> {
    const [progName, ...argv] = command.split(' ').filter(Boolean);
    const program = this.programs.get(progName);

    if (!program) {
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
        default:
          throw new Error(`Unknown syscall: ${call}`);
      }
    };
  }

  // --- Syscall Implementations ---

  private syscall_open(pcb: ProcessControlBlock, path: string, flags: string): FileDescriptor {
    const node = this.fs.getNode(path);
    if (!node) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    const fd = pcb.nextFd++;
    pcb.fds.set(fd, { node, position: 0, flags });
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

    // Actual file writing is not implemented in this milestone.
    throw new Error('File writing not supported yet.');
  }
} 