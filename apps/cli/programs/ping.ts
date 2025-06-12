import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);
    const ip = argv[0] || "127.0.0.1";
    const port = argv[1] ? parseInt(argv[1], 10) : 0;
    try {
        const conn = await syscall("udp_connect", ip, port);
        const start = Date.now();
        let responded = false;
        conn.onData(() => {
            responded = true;
        });
        conn.write(encode("ping"));
        const end = Date.now();
        if (responded) {
            await syscall("write", STDOUT_FD, encode("pong " + (end - start) + "ms\n"));
        } else {
            await syscall("write", STDERR_FD, encode("no response\n"));
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await syscall('write', STDERR_FD, encode('ping: ' + msg + '\n'));
        return 1;
    }
    return 0;
}

