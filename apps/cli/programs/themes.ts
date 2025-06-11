import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);

    if (argv[0] !== "select" || !argv[1]) {
        await syscall('write', STDERR_FD, enc('usage: themes select <name>\n'));
        return 1;
    }

    const name = argv[1];
    try { await syscall('mkdir', '/etc', 0o755); } catch {}
    const fd = await syscall('open', '/etc/theme', 'w');
    await syscall('write', fd, enc(name));
    await syscall('close', fd);
    await syscall('write', STDOUT_FD, enc(`theme set to ${name}\n`));
    return 0;
}
