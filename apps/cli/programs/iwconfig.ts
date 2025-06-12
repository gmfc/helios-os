import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);
    if (argv.length < 3) {
        await syscall("write", STDERR_FD, enc("usage: iwconfig <nic> <ssid> <passphrase>\n"));
        return 1;
    }
    const [nic, ssid, pass] = argv;
    try {
        const res = await syscall("wifi_join", nic, ssid, pass);
        if (typeof res === "number" && res < 0) {
            await syscall("write", STDERR_FD, enc("iwconfig: failed\n"));
            return 1;
        }
        return 0;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await syscall("write", STDERR_FD, enc("iwconfig: " + msg + "\n"));
        return 1;
    }
}
