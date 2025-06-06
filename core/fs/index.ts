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

const DEFAULT_ECHO = `export default {
  async main(syscall, argv) {
    const message = argv.join(' ') + '\n';
    const bytes = new TextEncoder().encode(message);
    await syscall('write', 1, bytes);
    return 0;
  }
};`;

const DEFAULT_CAT = `export default {
  async main(syscall, argv) {
    if (argv.length === 0) {
      console.error('cat: missing operand');
      return 1;
    }
    const path = argv[0];
    const STDOUT_FD = 1;
    const READ_CHUNK_SIZE = 1024;

    try {
      const fd = await syscall('open', path, 'r');
      while (true) {
        const data = await syscall('read', fd, READ_CHUNK_SIZE);
        if (data.length === 0) break;
        await syscall('write', STDOUT_FD, data);
      }
      return 0;
    } catch (error) {
      console.error(\`cat: ${path}: ${error.message}\`);
      return 1;
    }
  }
};`;

/**
 * A simple in-memory file system implementation.
 */
export interface FileSystemSnapshot {
  rootPath: string;
  nodes: Record<string, any>;
}

export type PersistHook = (snapshot: FileSystemSnapshot) => void;

export class InMemoryFileSystem {
  private root: FileSystemNode;
  private nodes: Map<string, FileSystemNode>;
  private static STORAGE_KEY = 'helios_fs';
  private persistHook?: PersistHook;

  constructor(snapshot?: FileSystemSnapshot, persistHook?: PersistHook) {
    this.persistHook = persistHook;
    const stored = snapshot ? this.deserialize(snapshot) : this.loadFromStorage();
    if (stored) {
      this.root = stored.root;
      this.nodes = stored.nodes;
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

    this.createDirectory('/etc', 0o755);
    this.createDirectory('/bin', 0o755);
    this.createFile('/etc/issue', 'Welcome to Helios-OS v0.1\n', 0o644);
    this.createFile('/bin/echo', DEFAULT_ECHO, 0o755);
    this.createFile('/bin/cat', DEFAULT_CAT, 0o755);
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
  public writeFile(path: string, data: Uint8Array, permissions: Permissions = 0o644) {
    let node = this.nodes.get(path);
    if (!node) {
      node = this.createFile(path, data, permissions);
      return node;
    }
    if (node.kind !== 'file') {
      throw new Error(`EISDIR: illegal operation on a directory, write`);
    }
    node.data = data;
    node.modifiedAt = new Date();
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

  private serialize(): any {
    const nodes: Record<string, any> = {};
    for (const [path, node] of this.nodes) {
      nodes[path] = {
        ...node,
        children: node.children ? Array.from(node.children.keys()) : undefined,
        data: node.data ? Array.from(node.data) : undefined,
      };
    }
    return { rootPath: this.root.path, nodes };
  }

  private deserialize(obj: FileSystemSnapshot): { root: FileSystemNode; nodes: Map<string, FileSystemNode> } | null {
    try {
      const nodes = new Map<string, FileSystemNode>();
      for (const path of Object.keys(obj.nodes)) {
        const n = obj.nodes[path];
        const node: FileSystemNode = {
          path: n.path,
          kind: n.kind,
          permissions: n.permissions,
          uid: n.uid,
          gid: n.gid,
          createdAt: new Date(n.createdAt),
          modifiedAt: new Date(n.modifiedAt),
          data: n.data ? new Uint8Array(n.data) : undefined,
          children: n.kind === 'dir' ? new Map<string, FileSystemNode>() : undefined,
        };
        nodes.set(path, node);
      }
      for (const path of Object.keys(obj.nodes)) {
        const n = obj.nodes[path];
        if (n.children) {
          const dir = nodes.get(path)!;
          for (const childPath of n.children) {
            const childName = childPath.split('/').pop()!;
            dir.children!.set(childName, nodes.get(childPath)!);
          }
        }
      }
      const root = nodes.get('/')!;
      return { root, nodes };
    } catch {
      return null;
    }
  }

  private loadFromStorage(): { root: FileSystemNode; nodes: Map<string, FileSystemNode> } | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(InMemoryFileSystem.STORAGE_KEY);
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw) as FileSystemSnapshot;
      return this.deserialize(obj);
    } catch {
      return null;
    }
  }

  private persist() {
    if (typeof localStorage !== 'undefined') {
      const json = JSON.stringify(this.serialize());
      localStorage.setItem(InMemoryFileSystem.STORAGE_KEY, json);
    }
    if (this.persistHook) {
      this.persistHook(this.serialize());
    }
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