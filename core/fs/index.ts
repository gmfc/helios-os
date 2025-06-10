import {
  ECHO_SOURCE,
  CAT_SOURCE,
  NANO_SOURCE,
  BROWSER_SOURCE,
  PING_SOURCE,
  DESKTOP_SOURCE,
  PS_SOURCE,
  INIT_SOURCE,
  LOGIN_SOURCE,
  BASH_SOURCE,
  REBOOT_SOURCE,
  SNAPSHOT_SOURCE,
  CAT_MANIFEST,
  ECHO_MANIFEST,
  NANO_MANIFEST,
  BROWSER_MANIFEST,
  PING_MANIFEST,
  DESKTOP_MANIFEST,
  PS_MANIFEST,
  SLEEP_SOURCE,
  SLEEP_MANIFEST,
  INIT_MANIFEST,
  LOGIN_MANIFEST,
  BASH_MANIFEST,
  REBOOT_MANIFEST,
  SNAPSHOT_MANIFEST,
} from './bin';
import { createPersistHook, loadSnapshot } from './sqlite';
import type { AsyncFileSystem } from './async';
import { getParentPath, getBaseName } from '../utils/path';

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
  virtual?: boolean;
  onRead?: () => Uint8Array | FileSystemNode[];
}

export type FileSystemSnapshot = {
  root: FileSystemNode;
  nodes: Map<string, FileSystemNode>;
};

export type Mount = {
  image: FileSystemSnapshot;
  path: string;
  createdMountPoint: boolean;
};

export type PersistHook = (snapshot: FileSystemSnapshot) => void;

export class InMemoryFileSystem implements AsyncFileSystem {
  private root: FileSystemNode;
  private nodes: Map<string, FileSystemNode>;
  private mounts: Map<string, Mount>;
  private persistHook?: PersistHook;

  constructor(snapshot?: FileSystemSnapshot, persistHook?: PersistHook) {
    this.persistHook = persistHook;
    this.mounts = new Map();
    if (snapshot) {
        const { root, nodes } = this.deserialize(snapshot);
        this.root = root;
        this.nodes = nodes;
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
    this.createFile('/bin/cat.manifest.json', CAT_MANIFEST, 0o644);
    this.createFile('/bin/echo', ECHO_SOURCE, 0o755);
    this.createFile('/bin/echo.manifest.json', ECHO_MANIFEST, 0o644);
    this.createFile('/bin/nano', NANO_SOURCE, 0o755);
    this.createFile('/bin/nano.manifest.json', NANO_MANIFEST, 0o644);
    this.createFile('/bin/browser', BROWSER_SOURCE, 0o755);
    this.createFile('/bin/browser.manifest.json', BROWSER_MANIFEST, 0o644);
    this.createFile('/bin/ping', PING_SOURCE, 0o755);
    this.createFile('/bin/ping.manifest.json', PING_MANIFEST, 0o644);
    this.createFile('/bin/desktop', DESKTOP_SOURCE, 0o755);
    this.createFile('/bin/desktop.manifest.json', DESKTOP_MANIFEST, 0o644);
    this.createFile('/bin/ps', PS_SOURCE, 0o755);
    this.createFile('/bin/ps.manifest.json', PS_MANIFEST, 0o644);
    this.createFile('/bin/sleep', SLEEP_SOURCE, 0o755);
    this.createFile('/bin/sleep.manifest.json', SLEEP_MANIFEST, 0o644);

    this.createDirectory('/sbin', 0o755);
    this.createFile('/sbin/init', INIT_SOURCE, 0o755);
    this.createFile('/sbin/init.manifest.json', INIT_MANIFEST, 0o644);
    this.createFile('/sbin/reboot', REBOOT_SOURCE, 0o755);
    this.createFile('/sbin/reboot.manifest.json', REBOOT_MANIFEST, 0o644);
    this.createFile('/sbin/snapshot', SNAPSHOT_SOURCE, 0o755);
    this.createFile('/sbin/snapshot.manifest.json', SNAPSHOT_MANIFEST, 0o644);
    this.createFile('/bin/login', LOGIN_SOURCE, 0o755);
    this.createFile('/bin/login.manifest.json', LOGIN_MANIFEST, 0o644);
    this.createFile('/bin/bash', BASH_SOURCE, 0o755);
    this.createFile('/bin/bash.manifest.json', BASH_MANIFEST, 0o644);

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
    const parentPath = getParentPath(path);
    const parent = this.nodes.get(parentPath);

    if (!parent || parent.kind !== 'dir') {
      throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
    }

    const directoryName = getBaseName(path);
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
    const parentPath = getParentPath(path);
    const parent = this.nodes.get(parentPath);

    if (!parent || parent.kind !== 'dir') {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    const fileName = getBaseName(path);
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
   * Creates a virtual file whose contents are provided on demand.
   */
  public createVirtualFile(
    path: string,
    onRead: () => Uint8Array,
    permissions: Permissions,
  ): FileSystemNode {
    if (this.nodes.has(path)) {
      throw new Error(`EEXIST: file already exists, open '${path}'`);
    }

    const now = new Date();
    const parentPath = getParentPath(path);
    const parent = this.nodes.get(parentPath);

    if (!parent || parent.kind !== 'dir') {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    const fileName = getBaseName(path);
    const fileNode: FileSystemNode = {
      path,
      kind: 'file',
      permissions,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      virtual: true,
      onRead,
    };

    parent.children?.set(fileName, fileNode);
    this.nodes.set(path, fileNode);
    return fileNode;
  }

  /**
   * Creates a virtual directory.
   */
  public createVirtualDirectory(path: string, permissions: Permissions): FileSystemNode {
    if (this.nodes.has(path)) {
      throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
    }

    const now = new Date();
    const parentPath = getParentPath(path);
    const parent = this.nodes.get(parentPath);

    if (!parent || parent.kind !== 'dir') {
      throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
    }

    const directoryName = getBaseName(path);
    const directoryNode: FileSystemNode = {
      path,
      kind: 'dir',
      permissions,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      children: new Map(),
      virtual: true,
    };

    parent.children?.set(directoryName, directoryNode);
    this.nodes.set(path, directoryNode);
    return directoryNode;
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
    if (node.virtual && node.onRead) {
      const data = node.onRead();
      return data instanceof Uint8Array ? data : new Uint8Array();
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

  /**
   * Returns a serializable snapshot of the file system.
   */
  public getSnapshot(): FileSystemSnapshot {
    return this.serialize();
  }

  /**
   * Create a deep copy of the filesystem preserving the persist hook.
   */
  public clone(): InMemoryFileSystem {
    const copyNode = (node: FileSystemNode): FileSystemNode => {
      const n: FileSystemNode = {
        path: node.path,
        kind: node.kind,
        permissions: node.permissions,
        uid: node.uid,
        gid: node.gid,
        createdAt: new Date(node.createdAt),
        modifiedAt: new Date(node.modifiedAt),
        virtual: node.virtual,
        onRead: node.onRead,
      };
      if (node.kind === 'file' && node.data) {
        n.data = new Uint8Array(node.data);
      }
      if (node.kind === 'dir') {
        n.children = new Map();
        for (const [name, child] of node.children ?? []) {
          const c = copyNode(child);
          n.children.set(name, c);
        }
      }
      return n;
    };

    const fs = Object.create(InMemoryFileSystem.prototype) as InMemoryFileSystem;
    fs.persistHook = this.persistHook;
    fs.mounts = new Map(this.mounts);
    fs.root = copyNode(this.root);
    fs.nodes = new Map();
    const populate = (node: FileSystemNode) => {
      fs.nodes.set(node.path, node);
      if (node.kind === 'dir') {
        for (const child of node.children?.values() ?? []) {
          populate(child);
        }
      }
    };
    populate(fs.root);
    return fs;
  }

  public mount(image: FileSystemSnapshot, path: string): Promise<void> {
    const snap = this.deserialize(image);
    let mountPoint = this.nodes.get(path);
    let createdMount = false;
    if (!mountPoint) {
      mountPoint = this.createDirectory(path, snap.root.permissions);
      createdMount = true;
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
      const parentPath = getParentPath(newPath);
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
      parent.children?.set(getBaseName(newPath), copy);
      this.nodes.set(newPath, copy);
    }

    this.mounts.set(path, { image, path, createdMountPoint: createdMount });
    this.persist();
    return Promise.resolve();
  }

  public unmount(path: string): Promise<void> {
    const mount = this.mounts.get(path);
    if (!mount) {
      throw new Error(`EINVAL: not a mount point, unmount '${path}'`);
    }

    const snap = this.deserialize(mount.image);
    const entries = Array.from(snap.nodes.values()).sort(
      (a, b) => b.path.split('/').length - a.path.split('/').length,
    );

    for (const node of entries) {
      if (node.path === '/') continue;
      const targetPath = path + (node.path === '/' ? '' : node.path);
      const parentPath = getParentPath(targetPath);
      const parent = this.nodes.get(parentPath);
      parent?.children?.delete(getBaseName(targetPath));
      this.nodes.delete(targetPath);
    }

    const mountPoint = this.nodes.get(path);
    if (mountPoint && mount.createdMountPoint) {
      if (!mountPoint.children || mountPoint.children.size === 0) {
        const parentPath = getParentPath(path);
        const parent = this.nodes.get(parentPath);
        parent?.children?.delete(getBaseName(path));
        this.nodes.delete(path);
      }
    }

    this.mounts.delete(path);
    this.persist();
    return Promise.resolve();
  }

  /**
   * Lists the contents of a directory.
   * @param path The directory to list.
   * @returns Array of nodes contained in the directory.
   */
  public listDirectory(path: string): FileSystemNode[] {
    const node = this.nodes.get(path);
    if (!node || node.kind !== 'dir') {
      throw new Error(`ENOTDIR: not a directory, scandir '${path}'`);
    }
    if (node.virtual && node.onRead) {
      const res = node.onRead();
      return Array.isArray(res) ? res : [];
    }
    return Array.from(node.children?.values() ?? []);
  }

  /**
   * Remove a file or empty directory.
   */
  public remove(path: string): void {
    const node = this.nodes.get(path);
    if (!node || path === '/') {
      throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
    }
    if (node.kind === 'dir' && node.children && node.children.size > 0) {
      throw new Error('ENOTEMPTY: directory not empty');
    }
    const parentPath = getParentPath(path);
    const parent = this.nodes.get(parentPath);
    if (!parent || parent.kind !== 'dir') {
      throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
    }
    parent.children?.delete(getBaseName(path));
    this.nodes.delete(path);
    this.persist();
  }

  /**
   * Rename a file or directory.
   */
  public rename(oldPath: string, newPath: string): Promise<void> {
    const node = this.nodes.get(oldPath);
    if (!node) {
      throw new Error(`ENOENT: no such file or directory, rename '${oldPath}'`);
    }
    if (this.nodes.has(newPath)) {
      throw new Error(`EEXIST: file already exists, rename '${newPath}'`);
    }
    const oldParent = this.nodes.get(getParentPath(oldPath));
    const newParent = this.nodes.get(getParentPath(newPath));
    if (!oldParent || oldParent.kind !== 'dir' || !newParent || newParent.kind !== 'dir') {
      throw new Error('ENOENT: invalid path');
    }
    oldParent.children?.delete(getBaseName(oldPath));
    newParent.children?.set(getBaseName(newPath), node);

    const updatePaths = (n: FileSystemNode, oldPrefix: string, newPrefix: string) => {
      const current = n.path;
      const updated = newPrefix + current.slice(oldPrefix.length);
      this.nodes.delete(current);
      n.path = updated;
      this.nodes.set(updated, n);
      if (n.kind === 'dir' && n.children) {
        for (const child of n.children.values()) {
          updatePaths(child, oldPrefix, newPrefix);
        }
      }
    };

    updatePaths(node, oldPath, newPath);
    this.persist();
    return Promise.resolve();
  }

  public async open(path: string, flags: string = 'r'): Promise<FileSystemNode> {
    let node = this.getNode(path);
    if (!node) {
      if (flags.includes('w') || flags.includes('a')) {
        node = this.createFile(path, new Uint8Array(), 0o644);
      } else {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
    }
    return Promise.resolve(node);
  }

  public async read(path: string): Promise<Uint8Array> {
    return Promise.resolve(this.readFile(path));
  }

  public async write(path: string, data: Uint8Array): Promise<void> {
    this.writeFile(path, data);
    return Promise.resolve();
  }

  public async mkdir(path: string, perms: Permissions): Promise<void> {
    this.createDirectory(path, perms);
    return Promise.resolve();
  }

  public async readdir(path: string): Promise<FileSystemNode[]> {
    return Promise.resolve(this.listDirectory(path));
  }

  public async unlink(path: string): Promise<void> {
    this.remove(path);
    return Promise.resolve();
  }

  private persist() {
    if (this.persistHook) {
      this.persistHook(this.serialize());
    }
  }

  private serialize(): FileSystemSnapshot {
    // Custom replacer to convert Map and Uint8Array for JSON.stringify
    const replacer = (_: string, value: any) => {
      if (value instanceof Map) {
        return {
          dataType: 'Map',
          value: Array.from(value.entries()),
        };
      }
      if (value instanceof Uint8Array) {
        const str = typeof Buffer !== 'undefined'
          ? Buffer.from(value).toString('base64')
          : btoa(String.fromCharCode(...Array.from(value)));
        return { dataType: 'Uint8Array', value: str };
      }
      return value;
    };
    return JSON.parse(
      JSON.stringify({ root: this.root, nodes: this.nodes }, replacer),
    );
  }

  private deserialize(snapshot: FileSystemSnapshot): FileSystemSnapshot {
    const reviver = (key: string, value: any) => {
      if (typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
          return new Map(value.value);
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
        if (key === 'createdAt' || key === 'modifiedAt') {
          return new Date(value);
        }
      }
      return value;
    };
    const parsed = JSON.parse(JSON.stringify(snapshot), reviver);
    return {
      root: parsed.root,
      nodes: parsed.nodes,
    };
  }

}

export type FileSystem = InMemoryFileSystem & AsyncFileSystem;

export async function loadFileSystem(): Promise<FileSystem | null> {
  const snapshot = await loadSnapshot();
  if (!snapshot) return null;
  return new InMemoryFileSystem(snapshot, createPersistHook());
}
