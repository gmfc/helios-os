import { Kernel, TcpConnection } from "../kernel";
import type { AsyncFileSystem } from "../fs/async";
import { join, normalize } from "path";

export interface ImapOptions {
    port?: number;
    root?: string;
}

export function startImapd(kernel: Kernel, opts: ImapOptions = {}): void {
    const port = opts.port ?? 143;
    const root = opts.root ?? "/var/mail";
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const fs = kernel.state.fs as AsyncFileSystem;

    kernel.registerService(`imapd:${port}`, port, "tcp", {
        onConnect(conn: TcpConnection) {
            let buffer = "";
            void conn.write(enc.encode("* OK Helios IMAP\r\n"));
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
                const [cmd, ...rest] = line.split(" ");
                switch (cmd.toUpperCase()) {
                    case "LIST": {
                        const user = rest[0] ?? "";
                        const dir = normalize(join(root, user));
                        let files: string[] = [];
                        try {
                            files = (await fs.readdir(dir)).map((n) =>
                                n.path.split("/").pop() ?? "",
                            );
                        } catch {}
                        for (const f of files) conn.write(enc.encode(f + "\r\n"));
                        conn.write(enc.encode(".\r\n"));
                        break;
                    }
                    case "RETR": {
                        const user = rest[0] ?? "";
                        const name = rest[1] ?? "";
                        const file = join(root, user, name);
                        try {
                            const data = await fs.read(file);
                            conn.write(data);
                            conn.write(enc.encode("\r\n.\r\n"));
                        } catch {
                            conn.write(enc.encode("ERR\r\n"));
                        }
                        break;
                    }
                    case "QUIT":
                        conn.write(enc.encode("BYE\r\n"));
                        break;
                    default:
                        conn.write(enc.encode("BAD\r\n"));
                }
            }
        },
    });
}

