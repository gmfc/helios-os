import type { FileSystemNode, FileSystemSnapshot } from "../../core/fs";
import type { ProcessID, FileDescriptor } from "../../core/kernel/process";
import type { WindowOpts, ServiceHandler, Snapshot } from "../../core/kernel";

export interface SyscallDispatcher {
    (call: "open", path: string, flags: string): Promise<FileDescriptor>;
    (call: "read", fd: FileDescriptor, length: number): Promise<Uint8Array>;
    (call: "write", fd: FileDescriptor, data: Uint8Array): Promise<number>;
    (call: "close", fd: FileDescriptor): Promise<number>;
    (call: "spawn", code: string, opts?: any): Promise<ProcessID>;
    (call: "listen", port: number, proto: string, cb: ServiceHandler): Promise<number>;
    (call: "connect", ip: string, port: number): Promise<number>;
    (call: "tcp_send" | "udp_send", sock: number, data: Uint8Array): Promise<number>;
    (call: "draw", html: Uint8Array, opts: WindowOpts): Promise<number>;
    (call: "mkdir", path: string, perms: number): Promise<number>;
    (call: "readdir", path: string): Promise<FileSystemNode[]>;
    (call: "unlink", path: string): Promise<number>;
    (call: "rename", oldPath: string, newPath: string): Promise<number>;
    (call: "add_monitor", width: number, height: number): Promise<number>;
    (call: "remove_monitor", id: number): Promise<number>;
    (call: "mount", image: FileSystemSnapshot, path: string): Promise<number>;
    (call: "unmount", path: string): Promise<number>;
    (call: "set_quota", ms?: number, mem?: number): Promise<{ quotaMs: number; quotaMem: number }>;
    (call: "kill", pid: ProcessID, sig?: number): Promise<number>;
    (call: "snapshot"): Promise<Snapshot>;
    (call: "save_snapshot" | "save_snapshot_named", name?: string): Promise<number>;
    (call: "load_snapshot_named", name: string): Promise<number>;
    (call: "ps"): Promise<Array<{ pid: number; argv?: string[]; exited?: boolean; cpuMs: number; memBytes: number; tty?: string }>>;
    (call: "jobs"): Promise<Array<{ id: number; pids: ProcessID[]; status: string }>>;
    (call: "reboot"): Promise<number>;
    (call: string, ...args: any[]): Promise<any>;
}
export {};
