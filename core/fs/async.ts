import type { FileSystemNode, FileSystemSnapshot, Permissions } from "./index";

export interface AsyncFileSystem {
    open(path: string, flags?: string): Promise<FileSystemNode | undefined>;
    read(path: string): Promise<Uint8Array>;
    write(path: string, data: Uint8Array): Promise<void>;
    mkdir(path: string, permissions: Permissions): Promise<void>;
    readdir(path: string): Promise<FileSystemNode[]>;
    unlink(path: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    mount(image: FileSystemSnapshot, path: string): Promise<void>;
    unmount(path: string): Promise<void>;

    /** Typed helper methods */
    getNode(path: string): FileSystemNode | undefined;
    createFile(
        path: string,
        data: string | Uint8Array,
        permissions: Permissions,
    ): FileSystemNode;
    createDirectory(path: string, permissions: Permissions): FileSystemNode;
    createVirtualFile(
        path: string,
        onRead: () => Uint8Array,
        permissions: Permissions,
    ): FileSystemNode;
    createVirtualDirectory(
        path: string,
        permissions: Permissions,
    ): FileSystemNode;
    writeFile(path: string, data: Uint8Array): FileSystemNode;
    readFile(path: string): Uint8Array;
    listDirectory(path: string): FileSystemNode[];
    remove(path: string): void;
    snapshotSubtree?(path: string): FileSystemSnapshot;
}
