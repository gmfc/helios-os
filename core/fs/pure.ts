import { InMemoryFileSystem, FileSystemNode } from './index';
import { createPersistHook } from './sqlite';

export type FileSystem = InMemoryFileSystem;
export type FileNode = FileSystemNode & { kind: 'file'; data: Uint8Array };

export function fsLookup(fs: FileSystem, path: string): FileSystemNode | undefined {
    return fs.getNode(path);
}

export function fsCreateFile(fs: FileSystem, path: string, perms: number = 0o644): FileSystem {
    const next = fs.clone();
    next.createFile(path, new Uint8Array(), perms);
    return next;
}

export function fsRead(fs: FileSystem, node: FileNode, off: number, len: number): { bytes: Uint8Array; newFs: FileSystem } {
    const data = node.data.subarray(off, off + len);
    return { bytes: data, newFs: fs.clone() };
}

export function fsWrite(fs: FileSystem, node: FileNode, off: number, data: Uint8Array): FileSystem {
    const next = fs.clone();
    const target = next.getNode(node.path);
    if (!target || target.kind !== 'file') {
        throw new Error('invalid node');
    }
    const existing = target.data ?? new Uint8Array();
    const buf = new Uint8Array(Math.max(existing.length, off + data.length));
    buf.set(existing);
    buf.set(data, off);
    next.writeFile(node.path, buf);
    return next;
}

export function bootstrapFileSystem(): FileSystem {
    return new InMemoryFileSystem(undefined, createPersistHook());
}

