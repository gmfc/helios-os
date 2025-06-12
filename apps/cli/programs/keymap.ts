import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);
    const dec = (b: Uint8Array) => new TextDecoder().decode(b);

    if (argv.length < 2) {
        await syscall('write', STDERR_FD, enc('usage: keymap <key> <code>\n'));
        return 1;
    }

    const key = argv[0];
    const code = parseInt(argv[1], 10);
    if (isNaN(code)) {
        await syscall('write', STDERR_FD, enc('keymap: invalid code\n'));
        return 1;
    }

    async function readConfig(): Promise<any> {
        try {
            const fd = await syscall('open', '/etc/input.json', 'r');
            let text = '';
            while (true) {
                const chunk = await syscall('read', fd, 1024);
                if (chunk.length === 0) break;
                text += dec(chunk);
            }
            await syscall('close', fd);
            return JSON.parse(text);
        } catch {
            return {};
        }
    }

    const cfg = await readConfig();
    if (!cfg.keymap || typeof cfg.keymap !== 'object') cfg.keymap = {};
    cfg.keymap[key] = code;

    try { await syscall('mkdir', '/etc', 0o755); } catch {}
    const fdw = await syscall('open', '/etc/input.json', 'w');
    await syscall('write', fdw, enc(JSON.stringify(cfg) + '\n'));
    await syscall('close', fdw);
    await syscall('write', STDOUT_FD, enc(`mapped ${key}\n`));
    return 0;
}
