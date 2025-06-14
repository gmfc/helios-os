import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);
    if (argv.length < 2) {
        await syscall('write', STDERR_FD, encode('mv: missing operand\n'));
        return 1;
    }
    try {
        await syscall('rename', argv[0], argv[1]);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await syscall('write', STDERR_FD, encode('mv: ' + msg + '\n'));
        return 1;
    }
    return 0;
}
