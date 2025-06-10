import assert from 'assert'
import fs from 'fs'
import { PersistentFileSystem } from './persistent'

type InvokeHandler = (cmd: string, args: any) => any

globalThis.window = {
    crypto: {
        getRandomValues: (arr: Uint32Array) => require('crypto').randomFillSync(arr)
    },
    __TAURI_INTERNALS__: { invoke: (_cmd: string, _args: any) => Promise.resolve(undefined) }
} as any

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
}

function setup(dbPath: string) {
    let nextId = 2
    let inodes = new Map<number, Inode>()
    let fileData = new Map<number, Uint8Array>()

    const load = () => {
        if (fs.existsSync(dbPath)) {
            const obj = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
            nextId = obj.nextId
            inodes = new Map(obj.inodes)
            fileData = new Map(obj.fileData.map((v: [number, number[]]) => [v[0], new Uint8Array(v[1])]))
        }
    }

    const persist = () => {
        const obj = {
            nextId,
            inodes: Array.from(inodes.entries()),
            fileData: Array.from(fileData.entries()).map(([k, v]) => [k, Array.from(v)])
        }
        fs.writeFileSync(dbPath, JSON.stringify(obj))
    }

    ;(window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
        switch (cmd) {
            case 'plugin:sql|load':
                load()
                if (!inodes.has(1)) {
                    inodes.set(1, {
                        id: 1,
                        parent_id: null,
                        name: '',
                        mode: args?.mode ?? 0o755,
                        uid: 0,
                        gid: 0,
                        size: 0,
                        ctime: Date.now(),
                        mtime: Date.now(),
                        atime: Date.now(),
                        kind: 'dir'
                    })
                }
                persist()
                return args.db
            case 'plugin:sql|execute': {
                const q = args.query.trim()
                const vals = args.values as any[]
                if (q.startsWith('BEGIN')) return [0, 0]
                if (q.startsWith('COMMIT') || q.startsWith('ROLLBACK')) return [0, 0]
                if (q.startsWith('PRAGMA') || q.startsWith('CREATE TABLE')) return [0, 0]
                if (q.startsWith('INSERT INTO inodes') && q.includes('VALUES (1,NULL')) {
                    const [mode, ctime, mtime, atime] = vals
                    inodes.set(1, { id: 1, parent_id: null, name: '', mode, uid: 0, gid: 0, size: 0, ctime, mtime, atime, kind: 'dir' })
                    persist()
                    return [1, 1]
                }
                if (q.startsWith('INSERT INTO inodes') && q.includes("'dir'")) {
                    const [pid, name, mode, ts] = vals
                    const id = nextId++
                    inodes.set(id, { id, parent_id: pid, name, mode, uid: 0, gid: 0, size: 0, ctime: ts, mtime: ts, atime: ts, kind: 'dir' })
                    persist()
                    return [1, id]
                }
                if (q.startsWith('INSERT INTO inodes') && q.includes("'file'")) {
                    const [pid, name, mode, size, ts] = vals
                    const id = nextId++
                    inodes.set(id, { id, parent_id: pid, name, mode, uid: 0, gid: 0, size, ctime: ts, mtime: ts, atime: ts, kind: 'file' })
                    persist()
                    return [1, id]
                }
                if (q.startsWith('INSERT INTO file_data')) {
                    const [id, data] = vals
                    fileData.set(id, new Uint8Array(data))
                    persist()
                    return [1, undefined]
                }
                if (q.startsWith('REPLACE INTO file_data')) {
                    const [id, data] = vals
                    fileData.set(id, new Uint8Array(data))
                    persist()
                    return [1, undefined]
                }
                if (q.startsWith('UPDATE inodes SET size')) {
                    const [size, ts, id] = vals
                    const node = inodes.get(id)!
                    node.size = size
                    node.mtime = ts
                    node.atime = ts
                    persist()
                    return [1, undefined]
                }
                if (q.startsWith('UPDATE inodes SET atime')) {
                    const [ts, id] = vals
                    const node = inodes.get(id)!
                    node.atime = ts
                    persist()
                    return [1, undefined]
                }
                if (q.startsWith('UPDATE inodes SET parent_id')) {
                    const [pid, name, id] = vals
                    const node = inodes.get(id)!
                    node.parent_id = pid
                    node.name = name
                    persist()
                    return [1, undefined]
                }
                if (q.startsWith('DELETE FROM inodes')) {
                    const [id] = vals
                    inodes.delete(id)
                    fileData.delete(id)
                    persist()
                    return [1, undefined]
                }
                return [0, 0]
            }
            case 'plugin:sql|select': {
                const q = args.query.trim()
                const vals = args.values as any[]
                if (q === 'SELECT * FROM inodes WHERE id=1') {
                    const n = inodes.get(1)
                    return n ? [n] : []
                }
                if (q === 'SELECT COUNT(*) as count FROM inodes') {
                    return [{ count: inodes.size }]
                }
                if (q.startsWith('SELECT * FROM inodes WHERE parent_id=?1 AND name=?2')) {
                    const [pid, name] = vals
                    for (const n of inodes.values()) {
                        if (n.parent_id === pid && n.name === name) return [n]
                    }
                    return []
                }
                if (q.startsWith('SELECT blob FROM file_data WHERE inode_id=?1')) {
                    const [id] = vals
                    const d = fileData.get(id) || new Uint8Array()
                    return [{ blob: d }]
                }
                if (q.startsWith('SELECT * FROM inodes WHERE parent_id=?1')) {
                    const [pid] = vals
                    return Array.from(inodes.values()).filter(n => n.parent_id === pid)
                }
                if (q.startsWith('SELECT id FROM inodes WHERE parent_id=?1')) {
                    const [pid] = vals
                    return Array.from(inodes.values()).filter(n => n.parent_id === pid).map(n => ({ id: n.id }))
                }
                return []
            }
            case 'plugin:sql|close':
                persist()
                return true
            default:
                return undefined
        }
    }
    return () => {
        (window as any).__TAURI_INTERNALS__.invoke = () => Promise.resolve(undefined)
        try { fs.unlinkSync(dbPath) } catch {}
    }
}

async function run() {
    const cleanup = setup('persistent_test.json')
    let fs1 = await PersistentFileSystem.load()
    await fs1.open('/persist.txt', 'w')
    await fs1.write('/persist.txt', new TextEncoder().encode('hello'))
    await fs1.mkdir('/dir', 0o755)
    await fs1.open('/dir/file.txt', 'w')
    let list = await fs1.readdir('/dir')
    assert(list.some(n => n.path === '/dir/file.txt'), 'file listed')
    await fs1.rename('/dir/file.txt', '/dir/renamed.txt')
    list = await fs1.readdir('/dir')
    assert(list.some(n => n.path === '/dir/renamed.txt'), 'rename works')
    await fs1.unlink('/dir/renamed.txt')
    list = await fs1.readdir('/dir')
    assert(!list.some(n => n.path === '/dir/renamed.txt'), 'unlink works')
    await (fs1 as any).db.close()

    const fs2 = await PersistentFileSystem.load()
    const data = await fs2.read('/persist.txt')
    assert(new TextDecoder().decode(data) === 'hello', 'file persists')
    console.log('Persistent FS basic ops test passed.')
    await (fs2 as any).db.close()

    cleanup()
}

run()
