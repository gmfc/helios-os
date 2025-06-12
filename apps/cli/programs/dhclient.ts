import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);
    if (argv.length !== 1) {
        await syscall("write", STDERR_FD, enc("usage: dhclient <nic>\n"));
        return 1;
    }
    try {
        const res = await syscall("dhcp_request", argv[0]);
        if (typeof res === "number" && res < 0) {
            await syscall("write", STDERR_FD, enc("dhclient: failed\n"));
            return 1;
        }
        const { ip, netmask } = res as { ip: string; netmask: string };
        await syscall("write", STDOUT_FD, enc(`${ip}/${netmask}\n`));
        return 0;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await syscall("write", STDERR_FD, enc("dhclient: " + msg + "\n"));
        return 1;
    }
}

