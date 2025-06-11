import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher): Promise<number> {
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);
    const decode = (b: Uint8Array) => new TextDecoder().decode(b);

    async function readFile(path: string): Promise<string> {
        const fd = await syscall('open', path, 'r');
        let out = '';
        while (true) {
            const chunk = await syscall('read', fd, 1024);
            if (chunk.length === 0) break;
            out += decode(chunk);
        }
        await syscall('close', fd);
        return out;
    }

    try {
        const code = await readFile('/bin/desktop');
        let manifest: { syscalls?: string[] } | undefined;
        try {
            manifest = JSON.parse(
                await readFile('/bin/desktop.manifest.json'),
            ) as { syscalls?: string[] };
        } catch {}
        await syscall('spawn', code, {
            argv: [],
            syscalls: manifest ? manifest.syscalls : undefined,
        });
    } catch {
        await syscall('write', STDERR_FD, encode('startx: failed to launch desktop\n'));
        return 1;
    }
    return 0;
}
