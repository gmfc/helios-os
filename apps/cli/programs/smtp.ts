import type { SyscallDispatcher } from "../../types/syscalls";
import { join, normalize } from "path";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const port = argv[0] ? parseInt(argv[0], 10) : 25;
    const root = argv[1] ?? "/var/mail";
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    await syscall("listen", port, "tcp", (conn) => {
        let buffer = "";
        let from = "";
        let to = "";
        let collecting = false;
        const lines: string[] = [];

        void conn.write(enc.encode("220 Helios SMTP\r\n"));
        conn.onData((d) => {
            buffer += dec.decode(d);
            void process();
        });

        async function process(): Promise<void> {
            while (true) {
                const idx = buffer.indexOf("\r\n");
                if (idx === -1) break;
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                await handle(line.trim());
            }
        }

        async function handle(line: string): Promise<void> {
            if (collecting) {
                if (line === ".") {
                    const dir = normalize(join(root, to));
                    try { await syscall("mkdir", "/var", 0o755); } catch {}
                    try { await syscall("mkdir", root, 0o755); } catch {}
                    try { await syscall("mkdir", dir, 0o755); } catch {}
                    const file = join(dir, `${Date.now()}.txt`);
                    await syscall("open", file, "w");
                    const content = `From: ${from}\r\nTo: ${to}\r\n` + lines.join("\r\n") + "\r\n";
                    await syscall("write", await syscall("open", file, "w"), enc.encode(content));
                    lines.length = 0;
                    collecting = false;
                    void conn.write(enc.encode("250 OK\r\n"));
                } else {
                    lines.push(line);
                }
                return;
            }
            const [cmd, ...rest] = line.split(" ");
            const arg = rest.join(" ");
            switch (cmd.toUpperCase()) {
                case "HELO":
                case "EHLO":
                    void conn.write(enc.encode("250 Hello\r\n"));
                    break;
                case "MAIL":
                    from = arg.split(":")[1] || "";
                    void conn.write(enc.encode("250 OK\r\n"));
                    break;
                case "RCPT":
                    to = (arg.split(":")[1] || "").replace(/[<>]/g, "");
                    void conn.write(enc.encode("250 OK\r\n"));
                    break;
                case "DATA":
                    collecting = true;
                    void conn.write(enc.encode("354 End data with <CR><LF>.<CR><LF>\r\n"));
                    break;
                case "QUIT":
                    void conn.write(enc.encode("221 Bye\r\n"));
                    break;
                default:
                    void conn.write(enc.encode("502 Command not implemented\r\n"));
            }
        }
    });

    return 0;
}


