import type { SyscallDispatcher } from "../../types/syscalls";

interface PackageEntry {
    name: string;
    path: string;
    sha256?: string;
}

async function readFile(syscall: SyscallDispatcher, path: string): Promise<Uint8Array> {
    const fd = await syscall('open', path, 'r');
    const chunks: Uint8Array[] = [];
    while (true) {
        const chunk: Uint8Array = await syscall('read', fd, 1024);
        if (chunk.length === 0) break;
        chunks.push(chunk);
    }
    await syscall('close', fd);
    let len = 0;
    for (const c of chunks) len += c.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
}

async function readText(syscall: SyscallDispatcher, path: string): Promise<string> {
    const data = await readFile(syscall, path);
    return new TextDecoder().decode(data);
}

function parseTar(buf: Uint8Array): Array<{ name: string; data: Uint8Array }> {
    const files: Array<{ name: string; data: Uint8Array }> = [];
    let offset = 0;
    while (offset + 512 <= buf.length) {
        const name = new TextDecoder()
            .decode(buf.subarray(offset, offset + 100))
            .replace(/\0.*$/, '');
        if (!name) break;
        const sizeText = new TextDecoder()
            .decode(buf.subarray(offset + 124, offset + 136))
            .replace(/\0.*$/, '')
            .trim();
        const size = parseInt(sizeText, 8) || 0;
        const start = offset + 512;
        const end = start + size;
        files.push({ name, data: buf.subarray(start, end) });
        offset = start + Math.ceil(size / 512) * 512;
    }
    return files;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    const arr = Array.from(new Uint8Array(hash));
    return arr.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);

    const action = argv[0];
    if (!action || (action !== 'search' && action !== 'install' && action !== 'remove')) {
        await syscall('write', STDERR_FD, encode('usage: apt <search|install|remove> <pkg>\n'));
        return 1;
    }

    let indexRaw: string;
    try {
        indexRaw = await readText(syscall, '/etc/apt/index.json');
    } catch {
        await syscall('write', STDERR_FD, encode('apt: index not found\n'));
        return 1;
    }

    let index: PackageEntry[];
    try {
        index = JSON.parse(indexRaw) as PackageEntry[];
    } catch {
        await syscall('write', STDERR_FD, encode('apt: bad index\n'));
        return 1;
    }

    if (action === 'search') {
        const term = argv[1] || '';
        for (const p of index) {
            if (p.name.includes(term)) {
                await syscall('write', STDOUT_FD, encode(p.name + '\n'));
            }
        }
        return 0;
    }

    if (action === 'remove') {
        const name = argv[1];
        if (!name) {
            await syscall('write', STDERR_FD, encode('apt remove: missing package name\n'));
            return 1;
        }
        let manRaw: string;
        try {
            manRaw = await readText(syscall, `/var/pkg/${name}.json`);
        } catch {
            await syscall('write', STDERR_FD, encode('apt: package not installed\n'));
            return 1;
        }
        let manifest: { files: string[] };
        try {
            manifest = JSON.parse(manRaw) as { files: string[] };
        } catch {
            await syscall('write', STDERR_FD, encode('apt: bad manifest\n'));
            return 1;
        }
        let owners: Array<[number, number]> = [];
        try {
            owners = await syscall('window_owners');
        } catch {}
        const toKill: number[] = [];
        for (const [, pid] of owners) {
            try {
                const fd = await syscall('open', `/proc/${pid}/status`, 'r');
                const data: Uint8Array[] = [];
                while (true) {
                    const chunk: Uint8Array = await syscall('read', fd, 256);
                    if (chunk.length === 0) break;
                    data.push(chunk);
                }
                await syscall('close', fd);
                let len2 = 0;
                for (const c of data) len2 += c.length;
                const buf = new Uint8Array(len2);
                let off2 = 0;
                for (const c of data) { buf.set(c, off2); off2 += c.length; }
                const text = new TextDecoder().decode(buf);
                if (text.includes(`cmd:\t${name}`)) toKill.push(pid);
            } catch {}
        }
        for (const pid of toKill) {
            await syscall('kill', pid, 9);
            try {
                const fds = await syscall('readdir', `/proc/${pid}/fd`);
                if (fds.length > 0) {
                    await syscall('write', STDERR_FD, encode(`apt: warning process ${pid} still has open fds\n`));
                }
            } catch {}
        }
        let services: Array<[string, { port: number; proto: string }]> = [];
        try {
            services = await syscall('list_services');
        } catch {}
        for (const [svc] of services) {
            if (svc.startsWith(name + ':') || svc === name) {
                try { await syscall('stop_service', svc); } catch {}
            }
        }
        for (const f of manifest.files) {
            try { await syscall('unlink', f); } catch {}
        }
        try { await syscall('unlink', `/var/pkg/${name}.json`); } catch {}
        await syscall('write', STDOUT_FD, encode('removed ' + name + '\n'));
        return 0;
    }

    const name = argv[1];
    if (!name) {
        await syscall('write', STDERR_FD, encode('apt install: missing package name\n'));
        return 1;
    }
    const pkg = index.find(p => p.name === name);
    if (!pkg) {
        await syscall('write', STDERR_FD, encode('apt: package not found\n'));
        return 1;
    }

    let data: Uint8Array;
    try {
        data = await readFile(syscall, pkg.path);
    } catch {
        await syscall('write', STDERR_FD, encode('apt: package file missing\n'));
        return 1;
    }

    if (pkg.sha256) {
        const digest = await sha256Hex(data);
        if (digest !== pkg.sha256) {
            await syscall('write', STDERR_FD, encode('apt: checksum failed\n'));
            return 1;
        }
    }

    const files = parseTar(data);
    let theme = false;
    for (const f of files) {
        if (f.name === 'theme.css' || f.name === 'wallpaper.jpg') theme = true;
    }

    const installed: string[] = [];
    if (theme) {
        try { await syscall('mkdir', '/opt', 0o755); } catch {}
        try { await syscall('mkdir', '/opt/themes', 0o755); } catch {}
        try { await syscall('mkdir', `/opt/themes/${name}`, 0o755); } catch {}
        for (const f of files) {
            const dest = `/opt/themes/${name}/` + f.name;
            const fd = await syscall('open', dest, 'w');
            await syscall('write', fd, f.data);
            await syscall('close', fd);
            installed.push(dest);
        }
    } else {
        try { await syscall('mkdir', '/usr', 0o755); } catch {}
        try { await syscall('mkdir', '/usr/bin', 0o755); } catch {}
        for (const f of files) {
            const dest = '/usr/bin/' + f.name;
            const fd = await syscall('open', dest, 'w');
            await syscall('write', fd, f.data);
            await syscall('close', fd);
            installed.push(dest);
        }
    }
    try { await syscall('mkdir', '/var', 0o755); } catch {}
    try { await syscall('mkdir', '/var/pkg', 0o755); } catch {}
    const manFd = await syscall('open', `/var/pkg/${name}.json`, 'w');
    await syscall('write', manFd, encode(JSON.stringify({ files: installed }) + '\n'));
    await syscall('close', manFd);
    await syscall('write', STDOUT_FD, encode('installed ' + name + '\n'));
    return 0;
}
