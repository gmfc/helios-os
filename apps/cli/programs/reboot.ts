import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher): Promise<number> {
    await syscall('reboot');
    return 0;
}
