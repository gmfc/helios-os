import { Kernel, TcpConnection } from "../kernel";
import type { AsyncFileSystem } from "../fs/async";

export interface FtpOptions {
    port?: number;
    root?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

export function startFtpd(kernel: Kernel, opts: FtpOptions = {}): void {
    const port = opts.port ?? 21;
    const root = opts.root ?? "/";
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const fs = kernel.state.fs as AsyncFileSystem;

    function resolve(p: string): string {
        const base = root.endsWith("/") ? root.slice(0, -1) : root;
        if (p.startsWith("/")) return base + p;
        return base + "/" + p;
    }

    kernel.registerService(`ftpd:${port}`, port, "tcp", {
        onConnect(conn: TcpConnection) {
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
                            const list = await fs.readdir(path);
                            const names = list.map((n) => n.path.split("/").pop()).join("\r\n");
                            const dataConn = kernel.state.tcp.connect(dataIp, dataPort);
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
                            const data = await fs.read(resolve(arg));
                            const slice = data.slice(0, MAX_BYTES);
                            const dataConn = kernel.state.tcp.connect(dataIp, dataPort);
                            dataConn.write(slice);
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
                        await fs.open(filePath, "w");
                        const chunks: Uint8Array[] = [];
                        let size = 0;
                        const dataConn = kernel.state.tcp.connect(dataIp, dataPort);
                        dataConn.onData((chunk) => {
                            if (size >= MAX_BYTES) return;
                            const available = Math.min(MAX_BYTES - size, chunk.length);
                            chunks.push(chunk.slice(0, available));
                            size += available;
                        });
                        await new Promise((r) => setTimeout(r, 10));
                        const total = size;
                        const buf = new Uint8Array(total);
                        let offset = 0;
                        for (const c of chunks) {
                            buf.set(c, offset);
                            offset += c.length;
                        }
                        await fs.write(filePath, buf);
                        conn.write(enc.encode("226 Transfer complete\r\n"));
                        break;
                    }
                    default:
                        conn.write(enc.encode("502 Command not implemented\r\n"));
                }
            }
        },
    });
}


