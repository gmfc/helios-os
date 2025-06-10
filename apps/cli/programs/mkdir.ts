import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);
    if (argv.length === 0) {
        await syscall('write', STDERR_FD, encode('mkdir: missing operand\n'));
        return 1;
    }
    try {
        await syscall('mkdir', argv[0], 0o755);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await syscall('write', STDERR_FD, encode('mkdir: ' + msg + '\n'));
        return 1;
    }
    return 0;
}
