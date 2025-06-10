import Database from '@tauri-apps/plugin-sql'
import type { AsyncFileSystem } from './async'
import type { FileSystemNode, FileSystemSnapshot, Permissions } from './index'
import {
    CAT_SOURCE,
    CAT_MANIFEST,
    ECHO_SOURCE,
    ECHO_MANIFEST,
    NANO_SOURCE,
    NANO_MANIFEST,
    BROWSER_SOURCE,
    BROWSER_MANIFEST,
    PING_SOURCE,
    PING_MANIFEST,
    DESKTOP_SOURCE,
    DESKTOP_MANIFEST,
    PS_SOURCE,
    PS_MANIFEST,
    SLEEP_SOURCE,
    SLEEP_MANIFEST,
    INIT_SOURCE,
    INIT_MANIFEST,
    REBOOT_SOURCE,
    REBOOT_MANIFEST,
    SNAPSHOT_SOURCE,
    SNAPSHOT_MANIFEST,
    LOGIN_SOURCE,
    LOGIN_MANIFEST,
    BASH_SOURCE,
    BASH_MANIFEST,
} from './bin'

class LRUCache<K, V> {
    private map = new Map<K, V>()
    constructor(private limit = 100) {}

    get(key: K): V | undefined {
        if (!this.map.has(key)) return undefined
        const val = this.map.get(key)!
        this.map.delete(key)
        this.map.set(key, val)
        return val
    }

    set(key: K, val: V): void {
        if (this.map.has(key)) this.map.delete(key)
        this.map.set(key, val)
        if (this.map.size > this.limit) {
            const first = this.map.keys().next().value
            if (first !== undefined) this.map.delete(first)
        }
    }

    delete(key: K) { this.map.delete(key) }
}

type Inode = {
    id: number
    parent_id: number | null
    name: string
    mode: number
    uid: number
    gid: number
    size: number
    ctime: number
    mtime: number
    atime: number
    kind: 'file' | 'dir' | 'symlink'
    target?: string | null
}

export class PersistentFileSystem implements AsyncFileSystem {
    private cache = new LRUCache<string, Inode | null>(256)

    constructor(private db: Database) {}

    static async load(): Promise<PersistentFileSystem> {
        const db = await Database.load('sqlite:helios.vfs')
        await db.execute('PRAGMA journal_mode=WAL;')
        await db.execute('PRAGMA foreign_keys=ON;')
        await db.execute(`CREATE TABLE IF NOT EXISTS inodes (
            id        INTEGER PRIMARY KEY,
            parent_id INTEGER,
            name      TEXT NOT NULL,
            mode      INTEGER NOT NULL,
            uid       INTEGER NOT NULL,
            gid       INTEGER NOT NULL,
            size      INTEGER NOT NULL DEFAULT 0,
            ctime     INTEGER NOT NULL,
            mtime     INTEGER NOT NULL,
            atime     INTEGER NOT NULL,
            kind      TEXT    NOT NULL,
            target    TEXT,
            CHECK (kind IN ('file','dir','symlink')),
            FOREIGN KEY(parent_id) REFERENCES inodes(id) ON DELETE CASCADE,
            UNIQUE(parent_id, name)
        )`)
        await db.execute(`CREATE TABLE IF NOT EXISTS file_data (
            inode_id INTEGER PRIMARY KEY,
            blob     BLOB NOT NULL,
            FOREIGN KEY(inode_id) REFERENCES inodes(id) ON DELETE CASCADE
        )`)
        await db.execute(`CREATE TABLE IF NOT EXISTS compile_cache (
            sha256      TEXT PRIMARY KEY,
            compiled_js BLOB NOT NULL,
            ts_mtime    INTEGER NOT NULL
        )`)
        const root = await db.select<Inode[]>('SELECT * FROM inodes WHERE id=1')
        if (root.length === 0) {
            const ts = Date.now()
            await db.execute('BEGIN IMMEDIATE')
            await db.execute(
                `INSERT INTO inodes (id,parent_id,name,mode,uid,gid,size,ctime,mtime,atime,kind)
                 VALUES (1,NULL,'',?,0,0,0,?,?,?,'dir')`,
                [0o755, ts, ts, ts]
            )
            await db.execute('COMMIT')
        }
        const fs = new PersistentFileSystem(db)
        const cnt = await db.select<{ count: number }[]>(
            'SELECT COUNT(*) as count FROM inodes'
        )
        if (cnt[0].count === 1) {
            await fs.writeTx(async () => {
                await fs.initDefaultFiles()
            })
        }
        return fs
    }

    private async lookup(path: string): Promise<Inode | undefined> {
        if (path === '/') {
            const res = await this.db.select<Inode[]>('SELECT * FROM inodes WHERE id=1')
            const inode = res[0]
            this.cache.set('/', inode)
            return inode
        }
        const cached = this.cache.get(path)
        if (cached !== undefined) return cached || undefined
        const parts = path.split('/').filter(p => p)
        let parentId = 1
        let curPath = ''
        let inode: Inode | undefined
        for (const part of parts) {
            curPath += '/' + part
            const c = this.cache.get(curPath)
            if (c !== undefined) {
                if (c === null) return undefined
                inode = c
                parentId = inode.id
                continue
            }
            const rows = await this.db.select<Inode[]>(
                'SELECT * FROM inodes WHERE parent_id=?1 AND name=?2',
                [parentId, part]
            )
            if (rows.length === 0) {
                this.cache.set(curPath, null)
                return undefined
            }
            inode = rows[0]
            this.cache.set(curPath, inode)
            parentId = inode.id
        }
        return inode
    }

    private async createDirectoryInternal(path: string, perms: Permissions): Promise<Inode> {
        const parentPath = this.getParentPath(path)
        const name = this.getBaseName(path)
        const parent = await this.lookup(parentPath)
        if (!parent || parent.kind !== 'dir') {
            throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`)
        }
        const ts = Date.now()
        const res = await this.db.execute(
            `INSERT INTO inodes (parent_id,name,mode,uid,gid,size,ctime,mtime,atime,kind)
             VALUES (?1,?2,?3,0,0,0,?4,?4,?4,'dir')`,
            [parent.id, name, perms, ts]
        )
        const id = res.lastInsertId as number
        const inode: Inode = { id, parent_id: parent.id, name, mode: perms, uid: 0, gid: 0, size: 0, ctime: ts, mtime: ts, atime: ts, kind: 'dir', target: null }
        this.cache.set(path, inode)
        return inode
    }

    private async createFileInternal(path: string, perms: Permissions, data: Uint8Array = new Uint8Array()): Promise<Inode> {
        const parentPath = this.getParentPath(path)
        const name = this.getBaseName(path)
        const parent = await this.lookup(parentPath)
        if (!parent || parent.kind !== 'dir') {
            throw new Error(`ENOENT: no such file or directory, open '${path}'`)
        }
        const ts = Date.now()
        const res = await this.db.execute(
            `INSERT INTO inodes (parent_id,name,mode,uid,gid,size,ctime,mtime,atime,kind)
             VALUES (?1,?2,?3,0,0,?4,?5,?5,?5,'file')`,
            [parent.id, name, perms, data.length, ts, ts, ts]
        )
        const id = res.lastInsertId as number
        await this.db.execute(
            `INSERT INTO file_data (inode_id, blob) VALUES (?1, ?2)`,
            [id, data]
        )
        const inode: Inode = { id, parent_id: parent.id, name, mode: perms, uid: 0, gid: 0, size: data.length, ctime: ts, mtime: ts, atime: ts, kind: 'file', target: null }
        this.cache.set(path, inode)
        return inode
    }

    private async writeTx(fn: () => Promise<void>) {
        await this.db.execute('BEGIN IMMEDIATE')
        try {
            await fn()
            await this.db.execute('COMMIT')
        } catch (e) {
            await this.db.execute('ROLLBACK')
            throw e
        }
    }

    private async initDefaultFiles(): Promise<void> {
        const enc = (s: string) => new TextEncoder().encode(s)

        await this.createDirectoryInternal('/etc', 0o755)
        await this.createFileInternal('/etc/issue', 0o644, enc('Welcome to Helios-OS v0.1\n'))

        await this.createDirectoryInternal('/bin', 0o755)
        await this.createFileInternal('/bin/cat', 0o755, enc(CAT_SOURCE))
        await this.createFileInternal('/bin/cat.manifest.json', 0o644, enc(CAT_MANIFEST))
        await this.createFileInternal('/bin/echo', 0o755, enc(ECHO_SOURCE))
        await this.createFileInternal('/bin/echo.manifest.json', 0o644, enc(ECHO_MANIFEST))
        await this.createFileInternal('/bin/nano', 0o755, enc(NANO_SOURCE))
        await this.createFileInternal('/bin/nano.manifest.json', 0o644, enc(NANO_MANIFEST))
        await this.createFileInternal('/bin/browser', 0o755, enc(BROWSER_SOURCE))
        await this.createFileInternal('/bin/browser.manifest.json', 0o644, enc(BROWSER_MANIFEST))
        await this.createFileInternal('/bin/ping', 0o755, enc(PING_SOURCE))
        await this.createFileInternal('/bin/ping.manifest.json', 0o644, enc(PING_MANIFEST))
        await this.createFileInternal('/bin/desktop', 0o755, enc(DESKTOP_SOURCE))
        await this.createFileInternal('/bin/desktop.manifest.json', 0o644, enc(DESKTOP_MANIFEST))
        await this.createFileInternal('/bin/ps', 0o755, enc(PS_SOURCE))
        await this.createFileInternal('/bin/ps.manifest.json', 0o644, enc(PS_MANIFEST))
        await this.createFileInternal('/bin/sleep', 0o755, enc(SLEEP_SOURCE))
        await this.createFileInternal('/bin/sleep.manifest.json', 0o644, enc(SLEEP_MANIFEST))

        await this.createDirectoryInternal('/sbin', 0o755)
        await this.createFileInternal('/sbin/init', 0o755, enc(INIT_SOURCE))
        await this.createFileInternal('/sbin/init.manifest.json', 0o644, enc(INIT_MANIFEST))
        await this.createFileInternal('/sbin/reboot', 0o755, enc(REBOOT_SOURCE))
        await this.createFileInternal('/sbin/reboot.manifest.json', 0o644, enc(REBOOT_MANIFEST))
        await this.createFileInternal('/sbin/snapshot', 0o755, enc(SNAPSHOT_SOURCE))
        await this.createFileInternal('/sbin/snapshot.manifest.json', 0o644, enc(SNAPSHOT_MANIFEST))
        await this.createFileInternal('/bin/login', 0o755, enc(LOGIN_SOURCE))
        await this.createFileInternal('/bin/login.manifest.json', 0o644, enc(LOGIN_MANIFEST))
        await this.createFileInternal('/bin/bash', 0o755, enc(BASH_SOURCE))
        await this.createFileInternal('/bin/bash.manifest.json', 0o644, enc(BASH_MANIFEST))
    }

    private getParentPath(path: string): string {
        const parts = path.split('/').filter(p => p)
        if (parts.length <= 1) return '/'
        return '/' + parts.slice(0, -1).join('/')
    }

    private getBaseName(path: string): string {
        return path.split('/').filter(p => p).pop() || ''
    }

    private toNode(fullPath: string, inode: Inode): FileSystemNode {
        return {
            path: fullPath,
            kind: inode.kind as 'file' | 'dir',
            permissions: inode.mode,
            uid: inode.uid,
            gid: inode.gid,
            createdAt: new Date(inode.ctime),
            modifiedAt: new Date(inode.mtime),
        }
    }

    async open(path: string, flags = 'r'): Promise<FileSystemNode | undefined> {
        let inode = await this.lookup(path)
        if (!inode) {
            if (flags.includes('w') || flags.includes('a')) {
                inode = await this.createFileInternal(path, 0o644)
            } else {
                throw new Error(`ENOENT: no such file or directory, open '${path}'`)
            }
        }
        if (inode.kind === 'dir') {
            throw new Error(`EISDIR: illegal operation on a directory, open '${path}'`)
        }
        const ts = Date.now()
        await this.db.execute('UPDATE inodes SET atime=?1 WHERE id=?2', [ts, inode.id])
        inode.atime = ts
        this.cache.set(path, inode)
        return this.toNode(path, inode)
    }

    async read(path: string): Promise<Uint8Array> {
        const inode = await this.lookup(path)
        if (!inode || inode.kind !== 'file') {
            throw new Error(`ENOENT: no such file or directory, read '${path}'`)
        }
        const rows = await this.db.select<{ blob: Uint8Array }[]>('SELECT blob FROM file_data WHERE inode_id=?1', [inode.id])
        const data = rows.length ? rows[0].blob : new Uint8Array()
        const ts = Date.now()
        await this.db.execute('UPDATE inodes SET atime=?1 WHERE id=?2', [ts, inode.id])
        inode.atime = ts
        this.cache.set(path, inode)
        return new Uint8Array(data)
    }

    async write(path: string, data: Uint8Array): Promise<void> {
        const inode = await this.lookup(path)
        if (!inode || inode.kind !== 'file') {
            throw new Error(`ENOENT: no such file or directory, write '${path}'`)
        }
        const ts = Date.now()
        await this.writeTx(async () => {
            await this.db.execute('REPLACE INTO file_data (inode_id, blob) VALUES (?1, ?2)', [inode.id, data])
            await this.db.execute('UPDATE inodes SET size=?1, mtime=?2, atime=?2 WHERE id=?3', [data.length, ts, inode.id])
        })
        inode.size = data.length
        inode.mtime = ts
        inode.atime = ts
        this.cache.set(path, inode)
    }

    async mkdir(path: string, permissions: Permissions): Promise<void> {
        await this.writeTx(async () => {
            await this.createDirectoryInternal(path, permissions)
        })
    }

    async readdir(path: string): Promise<FileSystemNode[]> {
        const inode = await this.lookup(path)
        if (!inode || inode.kind !== 'dir') {
            throw new Error(`ENOTDIR: not a directory, scandir '${path}'`)
        }
        const rows = await this.db.select<Inode[]>(
            'SELECT * FROM inodes WHERE parent_id=?1',
            [inode.id]
        )
        return rows.map(r => this.toNode(path + (path === '/' ? '' : '/') + r.name, r))
    }

    async unlink(path: string): Promise<void> {
        const inode = await this.lookup(path)
        if (!inode || path === '/') {
            throw new Error(`ENOENT: no such file or directory, unlink '${path}'`)
        }
        const children = await this.db.select<any[]>(
            'SELECT id FROM inodes WHERE parent_id=?1',
            [inode.id]
        )
        if (children.length > 0) {
            throw new Error('ENOTEMPTY: directory not empty')
        }
        await this.writeTx(async () => {
            await this.db.execute('DELETE FROM inodes WHERE id=?1', [inode.id])
        })
        this.cache.delete(path)
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        const inode = await this.lookup(oldPath)
        if (!inode) {
            throw new Error(`ENOENT: no such file or directory, rename '${oldPath}'`)
        }
        const newParentPath = this.getParentPath(newPath)
        const newParent = await this.lookup(newParentPath)
        if (!newParent || newParent.kind !== 'dir') {
            throw new Error('ENOENT: invalid path')
        }
        const name = this.getBaseName(newPath)
        await this.writeTx(async () => {
            await this.db.execute('UPDATE inodes SET parent_id=?1, name=?2 WHERE id=?3', [newParent.id, name, inode.id])
        })
        this.cache.delete(oldPath)
        this.cache.delete(newPath)
    }

    async mount(image: FileSystemSnapshot, path: string): Promise<void> {
        let mount = await this.lookup(path)
        if (!mount) {
            await this.mkdir(path, image.root.permissions)
            mount = await this.lookup(path)
        } else if (mount.kind !== 'dir') {
            throw new Error(`ENOTDIR: mount point is not a directory, mount '${path}'`)
        }
        const entries = Array.from(image.nodes.values()).sort(
            (a, b) => a.path.split('/').length - b.path.split('/').length
        )
        for (const node of entries) {
            if (node.path === '/') continue
            const newPath = path + (node.path === '/' ? '' : node.path)
            if (await this.lookup(newPath)) {
                throw new Error(`EEXIST: file already exists, mount '${newPath}'`)
            }
            if (node.kind === 'dir') {
                await this.mkdir(newPath, node.permissions)
            } else if (node.kind === 'file') {
                const data = node.data ?? new Uint8Array()
                await this.writeTx(async () => {
                    await this.createFileInternal(newPath, node.permissions, data)
                })
            }
        }
    }

    private async removeRecursive(id: number): Promise<void> {
        const children = await this.db.select<Inode[]>(
            'SELECT id FROM inodes WHERE parent_id=?1',
            [id]
        )
        for (const child of children) {
            await this.removeRecursive(child.id)
        }
        await this.db.execute('DELETE FROM inodes WHERE id=?1', [id])
    }

    async unmount(path: string): Promise<void> {
        const inode = await this.lookup(path)
        if (!inode) throw new Error(`EINVAL: not a mount point, unmount '${path}'`)
        await this.writeTx(async () => {
            await this.removeRecursive(inode.id)
        })
        this.cache.delete(path)
    }

    /**
     * Flush WAL and close the underlying database connection.
     * Should be called during shutdown to keep the DB compact.
     */
    async close(): Promise<void> {
        try {
            await this.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        } finally {
            await this.db.close()
        }
    }
}

export async function loadFileSystem(): Promise<PersistentFileSystem> {
    return PersistentFileSystem.load()
}

