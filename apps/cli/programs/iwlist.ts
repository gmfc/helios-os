import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, _argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);
    try {
        const list: string[] = await syscall("wifi_scan");
        await syscall("write", STDOUT_FD, enc(list.join("\n") + "\n"));
        return 0;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await syscall("write", STDERR_FD, enc("iwlist: " + msg + "\n"));
        return 1;
    }
}
