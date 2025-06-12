import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const port = argv[0] ? parseInt(argv[0], 10) : 21;
    const root = argv[1] ?? "/";
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    function resolve(p: string): string {
        const base = root.endsWith("/") ? root.slice(0, -1) : root;
        if (p.startsWith("/")) return base + p;
        return base + "/" + p;
    }

    await syscall("listen", port, "tcp", (conn) => {
        let buffer = "";
        let dataIp: string | null = null;
        let dataPort: number | null = null;

        conn.write(enc.encode("220 Helios FTP\r\n"));
        conn.onData((d) => {
            buffer += dec.decode(d);
            void processBuffer();
        });

        async function processBuffer() {
            while (true) {
                const idx = buffer.indexOf("\r\n");
                if (idx === -1) break;
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                await handle(line.trim());
            }
        }

        async function handle(line: string) {
            const [cmd, ...rest] = line.split(" ");
            const arg = rest.join(" ");
            switch (cmd.toUpperCase()) {
                case "USER":
                    conn.write(enc.encode("331 OK\r\n"));
                    break;
                case "PASS":
                    conn.write(enc.encode("230 Logged in\r\n"));
                    break;
                case "PORT": {
                    const nums = arg.split(",").map((n) => parseInt(n, 10));
                    if (nums.length === 6) {
                        dataIp = nums.slice(0, 4).join(".");
                        dataPort = (nums[4] << 8) | nums[5];
                        conn.write(enc.encode("200 PORT OK\r\n"));
                    } else {
                        conn.write(enc.encode("501 Bad PORT\r\n"));
                    }
                    break;
                }
                case "LIST": {
                    if (!dataIp || dataPort === null) {
                        conn.write(enc.encode("425 Use PORT first\r\n"));
                        break;
                    }
                    try {
                        const path = resolve(arg || ".");
                        const list: Array<{ path: string }> = await syscall("readdir", path);
                        const names = list.map((n) => n.path.split("/").pop()).join("\r\n");
                        const dataConn = await syscall("connect", dataIp, dataPort);
                        dataConn.write(enc.encode(names + "\r\n"));
                        conn.write(enc.encode("226 Transfer complete\r\n"));
                    } catch {
                        conn.write(enc.encode("550 Failed to list\r\n"));
                    }
                    break;
                }
                case "RETR": {
                    if (!dataIp || dataPort === null) {
                        conn.write(enc.encode("425 Use PORT first\r\n"));
                        break;
                    }
                    try {
                        const fd = await syscall("open", resolve(arg), "r");
                        const chunks: Uint8Array[] = [];
                        while (true) {
                            const c = await syscall("read", fd, 1024);
                            if (c.length === 0) break;
                            chunks.push(c);
                        }
                        await syscall("close", fd);
                        const total = chunks.reduce((n, c) => n + c.length, 0);
                        const buf = new Uint8Array(total);
                        let off = 0;
                        for (const c of chunks) { buf.set(c, off); off += c.length; }
                        const dataConn = await syscall("connect", dataIp, dataPort);
                        dataConn.write(buf);
                        conn.write(enc.encode("226 Transfer complete\r\n"));
                    } catch {
                        conn.write(enc.encode("550 Failed to open file\r\n"));
                    }
                    break;
                }
                case "STOR": {
                    if (!dataIp || dataPort === null) {
                        conn.write(enc.encode("425 Use PORT first\r\n"));
                        break;
                    }
                    const filePath = resolve(arg);
                    await syscall("open", filePath, "w");
                    const chunks: Uint8Array[] = [];
                    const dataConn = await syscall("connect", dataIp, dataPort);
                    dataConn.onData((chunk) => {
                        chunks.push(chunk);
                    });
                    await new Promise((r) => setTimeout(r, 10));
                    const total = chunks.reduce((n, c) => n + c.length, 0);
                    const buf = new Uint8Array(total);
                    let off = 0;
                    for (const c of chunks) { buf.set(c, off); off += c.length; }
                    await syscall("write", await syscall("open", filePath, "w"), buf);
                    conn.write(enc.encode("226 Transfer complete\r\n"));
                    break;
                }
                default:
                    conn.write(enc.encode("502 Command not implemented\r\n"));
            }
        }
    });

    return 0;
}


