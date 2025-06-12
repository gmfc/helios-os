import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);
    const dec = (b: Uint8Array) => new TextDecoder().decode(b);

    async function readFile(path: string): Promise<string> {
        const fd = await syscall("open", path, "r");
        let out = "";
        while (true) {
            const chunk = await syscall("read", fd, 1024);
            if (chunk.length === 0) break;
            out += dec(chunk);
        }
        await syscall("close", fd);
        return out;
    }

    async function readLine(fd: number): Promise<string> {
        let line = "";
        while (true) {
            const chunk = await syscall("read", fd, 1);
            if (chunk.length === 0) continue;
            const ch = dec(chunk);
            if (ch === "\n") break;
            line += ch;
        }
        return line;
    }

    async function gatherLogs(): Promise<string> {
        let logs = "";
        try {
            const entries: { path: string }[] = await syscall("readdir", "/var/log");
            for (const e of entries) {
                const name = e.path.split("/").pop();
                if (!name) continue;
                try {
                    const text = await readFile(`/var/log/${name}`);
                    const lines = text.trimEnd().split("\n");
                    const recent = lines.slice(-50).join("\n");
                    logs += `-- ${name} --\n${recent}\n`;
                } catch {}
            }
        } catch {}
        return logs;
    }

    let tty = STDOUT_FD;
    try {
        tty = await syscall("open", "/dev/tty0", "rw");
    } catch {}

    await syscall("write", tty, enc("Describe the issue and press Enter:\n> "));
    const desc = (await readLine(tty)).trim();

    const logData = await gatherLogs();
    const report =
        `Time: ${new Date().toISOString()}\n` +
        `Description:\n${desc}\n\n` +
        (logData ? `Logs:\n${logData}` : "Logs: none\n");

    try { await syscall("mkdir", "/var", 0o755); } catch {}
    try { await syscall("mkdir", "/var/bugreports", 0o755); } catch {}

    const path = `/var/bugreports/${Date.now()}.txt`;
    const fd = await syscall("open", path, "w");
    await syscall("write", fd, enc(report));
    await syscall("close", fd);

    await syscall("write", tty, enc(`Report saved to ${path}\n`));
    if (tty !== STDOUT_FD) await syscall("close", tty);
    return 0;
}
