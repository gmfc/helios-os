import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);
    if (argv.length < 3) {
        await syscall("write", STDERR_FD, enc("usage: sendmail <ip> <to> <msg>\n"));
        return 1;
    }
    const ip = argv[0];
    const to = argv[1];
    const msg = argv.slice(2).join(" ");
    try {
        const conn = await syscall("connect", ip, 25);
        const send = (s: string) => conn.write(enc(s + "\r\n"));
        send("HELO localhost");
        send("MAIL FROM:<user@localhost>");
        send(`RCPT TO:<${to}>`);
        send("DATA");
        send(msg);
        send(".");
        send("QUIT");
        await syscall("write", STDOUT_FD, enc("sent\n"));
        return 0;
    } catch (e: unknown) {
        const msgStr = e instanceof Error ? e.message : String(e);
        await syscall("write", STDERR_FD, enc("sendmail: " + msgStr + "\n"));
        return 1;
    }
}


