import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);

    if (argv.length < 2) {
        await syscall("write", STDERR_FD, enc("usage: route <add|del> <cidr> [nic]\n"));
        return 1;
    }

    const action = argv[0];
    const cidr = argv[1];
    if (action === "add") {
        if (argv.length !== 3) {
            await syscall("write", STDERR_FD, enc("usage: route add <cidr> <nic>\n"));
            return 1;
        }
        const nic = argv[2];
        const res = await syscall("route_add", cidr, nic);
        if (typeof res === "number" && res < 0) {
            await syscall("write", STDERR_FD, enc("route: failed\n"));
            return 1;
        }
        return 0;
    }
    if (action === "del") {
        const res = await syscall("route_del", cidr);
        if (typeof res === "number" && res < 0) {
            await syscall("write", STDERR_FD, enc("route: failed\n"));
            return 1;
        }
        return 0;
    }

    await syscall("write", STDERR_FD, enc("route: unknown action\n"));
    return 1;
}

