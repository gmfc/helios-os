import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher): Promise<number> {
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);
    const decode = (b: Uint8Array) => new TextDecoder().decode(b);

    async function readFile(path: string): Promise<string> {
        const fd = await syscall("open", path, "r");
        let out = "";
        while (true) {
            const chunk = await syscall("read", fd, 1024);
            if (chunk.length === 0) break;
            out += decode(chunk);
        }
        await syscall("close", fd);
        return out;
    }

    async function readLine(fd: number): Promise<string> {
        let line = "";
        while (true) {
            const chunk = await syscall("read", fd, 1);
            if (chunk.length === 0) break;
            const ch = decode(chunk);
            if (ch === "\n") break;
            line += ch;
        }
        return line;
    }

    const ttyName = "tty0";
    let tty: number;
    try {
        tty = await syscall("open", "/dev/" + ttyName, "rw");
    } catch {
        await syscall(
            "write",
            STDERR_FD,
            encode("login: /dev/" + ttyName + " not found\n"),
        );
        return 1;
    }

    await syscall("write", tty, encode("login: "));
    await readLine(tty);
    await syscall("write", tty, encode("password: "));
    await readLine(tty);
    await syscall("close", tty);

    try {
        const code = await readFile("/bin/bash");
        let m: { syscalls?: string[] } | undefined;
        try {
            m = JSON.parse(await readFile("/bin/bash.manifest.json")) as {
                syscalls?: string[];
            };
        } catch {}
        await syscall("spawn", code, {
            syscalls: m ? m.syscalls : undefined,
            tty: ttyName,
        });
    } catch {
        await syscall(
            "write",
            STDERR_FD,
            encode("login: failed to launch shell\n"),
        );
        return 1;
    }
    return 0;
}
