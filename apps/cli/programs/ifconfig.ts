import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);
    try {
        if (argv.length === 0) {
            const list: Array<{ id: string; mac: string; ip?: string; netmask?: string; status: string; ssid?: string }> = await syscall("list_nics");
            let out = "";
            for (const n of list) {
                const ip = n.ip ?? "0.0.0.0";
                const mask = n.netmask ?? "0";
                out += `${n.id} ${ip}/${mask} ${n.status}\n`;
            }
            await syscall("write", STDOUT_FD, enc(out));
            return 0;
        }
        const id = argv[0];
        if (argv.length === 2) {
            if (argv[1] === "up") {
                await syscall("nic_up", id);
                return 0;
            }
            if (argv[1] === "down") {
                await syscall("nic_down", id);
                return 0;
            }
            if (argv[1].includes("/")) {
                const [ip, mask] = argv[1].split("/");
                await syscall("nic_config", id, ip, mask);
                return 0;
            }
        }
        await syscall("write", STDERR_FD, enc("ifconfig: bad usage\n"));
        return 1;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await syscall("write", STDERR_FD, enc("ifconfig: " + msg + "\n"));
        return 1;
    }
}
