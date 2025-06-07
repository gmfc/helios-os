import { ECHO_SOURCE, CAT_SOURCE } from './bin';
import { createPersistHook } from './sqlite';

/**
 * Represents file permissions using a UNIX-like octal number.
 */
export type Permissions = number;

/**
 * Defines a node in the file system, which can be either a file or a directory.
 */
export interface FileSystemNode {
  path: string;
  kind: 'file' | 'dir';
  permissions: Permissions;
  uid: number;
  gid: number;
  createdAt: Date;
  modifiedAt: Date;
  data?: Uint8Array;
  children?: Map<string, FileSystemNode>;
}

export type FileSystemSnapshot = {
  root: FileSystemNode;
  nodes: Map<string, FileSystemNode>;
};

export type Mount = {
  image: FileSystemSnapshot;
  path: string;
};

export type PersistHook = (snapshot: FileSystemSnapshot) => void;

export class InMemoryFileSystem {
  private root: FileSystemNode;
  private nodes: Map<string, FileSystemNode>;
  private mounts: Map<string, Mount>;
  private persistHook?: PersistHook;

  constructor(snapshot?: FileSystemSnapshot, persistHook?: PersistHook) {
    this.persistHook = persistHook;
    this.mounts = new Map();
    if (snapshot) {
        this.root = this.deserialize(snapshot).root;
        this.nodes = this.deserialize(snapshot).nodes;
        return;
    }

    const now = new Date();
    this.root = {
      path: '/',
      kind: 'dir',
      permissions: 0o755,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      children: new Map(),
    };
    this.nodes = new Map([['/', this.root]]);
    this.initDefaultFiles();
  }

  private initDefaultFiles() {
    this.createDirectory('/etc', 0o755);
    this.createFile('/etc/issue', 'Welcome to Helios-OS v0.1\n', 0o644);
    
    this.createDirectory('/bin', 0o755);
    this.createFile('/bin/cat', CAT_SOURCE, 0o755);
    this.createFile('/bin/echo', ECHO_SOURCE, 0o755);

    const bundled = (globalThis as any).BUNDLED_DISK_IMAGES as
      | Array<{ image: FileSystemSnapshot; path: string }>
      | undefined;
    if (bundled) {
      for (const m of bundled) {
        try {
          this.mount(m.image, m.path);
        } catch (e) {
          console.error('Failed to mount bundled image', m.path, e);
        }
      }
    }

    this.persist();
  }

  /**
   * Creates a new directory at the specified path.
   * @param path The full path of the new directory.
   * @param permissions The permissions for the new directory.
   * @returns The newly created directory node.
   */
  public createDirectory(path: string, permissions: Permissions): FileSystemNode {
    if (this.nodes.has(path)) {
      throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
    }

    const now = new Date();
    const parentPath = this.getParentPath(path);
    const parent = this.nodes.get(parentPath);

    if (!parent || parent.kind !== 'dir') {
      throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
    }

    const directoryName = this.getBaseName(path);
    const directoryNode: FileSystemNode = {
      path,
      kind: 'dir',
      permissions,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      children: new Map(),
    };

    parent.children?.set(directoryName, directoryNode);
    this.nodes.set(path, directoryNode);
    this.persist();
    return directoryNode;
  }

  /**
   * Creates a new file with the given content at the specified path.
   * @param path The full path of the new file.
   * @param data The content of the file.
   * @param permissions The permissions for the new file.
   * @returns The newly created file node.
   */
  public createFile(path: string, data: string | Uint8Array, permissions: Permissions): FileSystemNode {
    if (this.nodes.has(path)) {
      throw new Error(`EEXIST: file already exists, open '${path}'`);
    }

    const now = new Date();
    const parentPath = this.getParentPath(path);
    const parent = this.nodes.get(parentPath);

    if (!parent || parent.kind !== 'dir') {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    const fileName = this.getBaseName(path);
    const fileData = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const fileNode: FileSystemNode = {
      path,
      kind: 'file',
      permissions,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      data: fileData,
    };

    parent.children?.set(fileName, fileNode);
    this.nodes.set(path, fileNode);
    this.persist();
    return fileNode;
  }

  /**
   * Overwrites the content of an existing file or creates it if it does not exist.
   */
  public writeFile(path: string, data: Uint8Array): FileSystemNode {
    const node = this.nodes.get(path);
    if (!node || node.kind !== 'file') {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    node.data = data;
    this.persist();
    return node;
  }

  /**
   * Reads the content of a file.
   * @param path The path of the file to read.
   * @returns The file content as a Uint8Array.
   */
  public readFile(path: string): Uint8Array {
    const node = this.nodes.get(path);
    if (!node) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    if (node.kind !== 'file') {
      throw new Error(`EISDIR: illegal operation on a directory, read`);
    }
    return node.data || new Uint8Array();
  }

  /**
   * Retrieves a node from the file system.
   * @param path The path of the node to retrieve.
   * @returns The file system node, or undefined if not found.
   */
  public getNode(path: string): FileSystemNode | undefined {
    return this.nodes.get(path);
  }

  public mount(image: FileSystemSnapshot, path: string): void {
    const snap = this.deserialize(image);
    let mountPoint = this.nodes.get(path);
    if (!mountPoint) {
      mountPoint = this.createDirectory(path, snap.root.permissions);
    } else if (mountPoint.kind !== 'dir') {
      throw new Error(`ENOTDIR: mount point is not a directory, mount '${path}'`);
    }

    const entries = Array.from(snap.nodes.values()).sort(
      (a, b) => a.path.split('/').length - b.path.split('/').length,
    );
    for (const node of entries) {
      if (node.path === '/') continue;
      const newPath = path + (node.path === '/' ? '' : node.path);
      if (this.nodes.has(newPath)) {
        throw new Error(`EEXIST: file already exists, mount '${newPath}'`);
      }
      const parentPath = this.getParentPath(newPath);
      const parent = this.nodes.get(parentPath);
      if (!parent || parent.kind !== 'dir') {
        throw new Error(`ENOENT: no such directory, mount '${parentPath}'`);
      }
      const copy: FileSystemNode = {
        path: newPath,
        kind: node.kind,
        permissions: node.permissions,
        uid: node.uid,
        gid: node.gid,
        createdAt: new Date(node.createdAt),
        modifiedAt: new Date(node.modifiedAt),
        data: node.kind === 'file' && node.data ? new Uint8Array(node.data) : undefined,
        children: node.kind === 'dir' ? new Map() : undefined,
      };
      parent.children?.set(this.getBaseName(newPath), copy);
      this.nodes.set(newPath, copy);
    }

    this.mounts.set(path, { image, path });
    this.persist();
  }

  private persist() {
    if (this.persistHook) {
      this.persistHook(this.serialize());
    }
  }

  private serialize(): FileSystemSnapshot {
    // Custom replacer to convert Map to Array for JSON.stringify
    const replacer = (key, value) => {
      if(value instanceof Map) {
        return {
          dataType: 'Map',
          value: Array.from(value.entries()),
        };
      } else {
        return value;
      }
    };
    return JSON.parse(JSON.stringify({ root: this.root, nodes: this.nodes }, replacer));
  }

  private deserialize(snapshot: FileSystemSnapshot): FileSystemSnapshot {
    const reviver = (key, value) => {
        if(typeof value === 'object' && value !== null) {
          if (value.dataType === 'Map') {
            return new Map(value.value);
          }
          if (key === 'createdAt' || key === 'modifiedAt') {
              return new Date(value);
          }
        }
        return value;
    };
    const parsed = JSON.parse(JSON.stringify(snapshot), reviver);
    return {
        root: parsed.root,
        nodes: parsed.nodes
    };
  }

  private getParentPath(path: string): string {
    const parts = path.split('/').filter(p => p);
    if (parts.length <= 1) return '/';
    return '/' + parts.slice(0, -1).join('/');
  }

  private getBaseName(path: string): string {
    return path.split('/').filter(p => p).pop() || '';
  }
} 