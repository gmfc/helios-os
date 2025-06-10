import type { SyscallDispatcher } from "../../core/kernel/syscalls";

export async function main(_syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const ms = parseInt(argv[0] || '1', 10) * 1000;
    await new Promise(r => setTimeout(r, ms));
    return 0;
}
