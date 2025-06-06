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

/**
 * A simple in-memory file system implementation.
 */
export class InMemoryFileSystem {
  private root: FileSystemNode;
  private nodes: Map<string, FileSystemNode>;

  constructor() {
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
    this.createFile('/etc/issue', 'Welcome to Helios-OS v0.1\n', 0o644);
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
    return fileNode;
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

  private getParentPath(path: string): string {
    const parts = path.split('/').filter(p => p);
    if (parts.length <= 1) return '/';
    return '/' + parts.slice(0, -1).join('/');
  }

  private getBaseName(path: string): string {
    return path.split('/').filter(p => p).pop() || '';
  }
} 