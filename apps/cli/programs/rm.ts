import type { SyscallDispatcher } from "../../core/kernel/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);
    if (argv.length === 0) {
        await syscall('write', STDERR_FD, encode('rm: missing operand\n'));
        return 1;
    }
    try {
        await syscall('unlink', argv[0]);
    } catch (e: any) {
        await syscall('write', STDERR_FD, encode('rm: ' + e.message + '\n'));
        return 1;
    }
    return 0;
}
