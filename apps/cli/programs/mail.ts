import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);
    const dec = new TextDecoder();
    if (argv.length < 2) {
        await syscall("write", STDERR_FD, enc("usage: mail <ip> <user> [file]\n"));
        return 1;
    }
    const ip = argv[0];
    const user = argv[1];
    const file = argv[2];
    try {
        const conn = await syscall("connect", ip, 143);
        let buf = "";
        conn.onData((d) => {
            buf += dec.decode(d);
        });
        const send = (s: string) => conn.write(enc(s + "\r\n"));
        if (file) {
            send(`RETR ${user} ${file}`);
        } else {
            send(`LIST ${user}`);
        }
        await new Promise((r) => setTimeout(r, 20));
        await syscall("write", STDOUT_FD, enc(buf));
        return 0;
    } catch (e: unknown) {
        const msgStr = e instanceof Error ? e.message : String(e);
        await syscall("write", STDERR_FD, enc("mail: " + msgStr + "\n"));
        return 1;
    }
}


