import type { SyscallDispatcher } from "../../core/kernel/syscalls";

export async function main(syscall: SyscallDispatcher): Promise<number> {
    await syscall('reboot');
    return 0;
}
