import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const port = argv[0] ? parseInt(argv[0], 10) : 22;
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    async function readFile(path: string): Promise<string> {
        const fd = await syscall("open", path, "r");
        let out = "";
        while (true) {
            const chunk = await syscall("read", fd, 1024);
            if (chunk.length === 0) break;
            out += dec.decode(chunk);
        }
        await syscall("close", fd);
        return out;
    }

    async function selfPid(): Promise<number> {
        const list: Array<{ pid: number; argv?: string[] }> = await syscall("ps");
        const proc = list.find((p) => p.argv && p.argv[0] === "ssh");
        return proc ? proc.pid : list[list.length - 1].pid;
    }

    await syscall("listen", port, "tcp", (conn) => {
        conn.write(enc.encode("login: "));
        let stage: "user" | "pass" | "shell" = "user";
        let master: number | null = null;
        let slave: string | null = null;

        conn.onData(async (data) => {
            if (stage === "shell") {
                if (master !== null) await syscall("write", master, data);
                return;
            }
            const text = dec.decode(data);
            for (const ch of text) {
                if (stage === "user") {
                    if (ch === "\n") {
                        stage = "pass";
                        conn.write(enc.encode("password: "));
                    }
                } else if (stage === "pass") {
                    if (ch === "\n") {
                        stage = "shell";
                        conn.write(enc.encode("\nWelcome to Helios-OS\n"));
                        master = await syscall("open", "/dev/ptmx", "rw");
                        const pid = await selfPid();
                        const fdPathFd = await syscall("open", `/proc/${pid}/fd/${master}`, "r");
                        let path = "";
                        while (true) {
                            const c = await syscall("read", fdPathFd, 64);
                            if (c.length === 0) break;
                            path += dec.decode(c);
                        }
                        await syscall("close", fdPathFd);
                        const idMatch = path.match(/pty(\d+)/);
                        const id = idMatch ? parseInt(idMatch[1], 10) : 0;
                        slave = `/dev/tty${id}`;
                        const bash = await readFile("/bin/bash");
                        let man: { syscalls?: string[] } | undefined;
                        try {
                            man = JSON.parse(await readFile("/bin/bash.manifest.json")) as { syscalls?: string[] };
                        } catch {}
                        await syscall("spawn", bash, { argv: [`tty${id}`], tty: slave, syscalls: man ? man.syscalls : undefined });
                        setInterval(async () => {
                            if (master === null) return;
                            const buf = await syscall("read", master, 1024);
                            if (buf.length > 0) conn.write(buf);
                        }, 10);
                    }
                }
            }
        });
    });

    return 0;
}


