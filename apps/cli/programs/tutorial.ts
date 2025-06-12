import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher): Promise<number> {
    const STDOUT_FD = 1;
    const enc = (s: string) => new TextEncoder().encode(s);
    const msg =
        "Helios-OS quick start:\n" +
        " - Use `help` or `man <cmd>` for documentation.\n" +
        " - Files live under /home and /etc.\n" +
        " - `startx` launches the desktop.\n";
    await syscall("write", STDOUT_FD, enc(msg));
    return 0;
}

