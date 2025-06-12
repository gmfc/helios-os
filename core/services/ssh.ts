import { Kernel, TcpConnection } from "../kernel";

export interface SshOptions {
    port?: number;
}

export function startSshd(kernel: Kernel, opts: SshOptions = {}): void {
    const port = opts.port ?? 22;
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    kernel.registerService(`sshd:${port}`, port, "tcp", {
        onConnect(conn: TcpConnection) {
            conn.write(enc.encode("login: "));
            let stage: "user" | "pass" | "shell" = "user";
            let user = "";
            let pass = "";
            let ptyId: number | null = null;

            const ptys = (kernel as any).ptys;
            const fs = (kernel as any).state.fs as any;

            function startShell() {
                const alloc = ptys.allocate();
                if (!fs.getNode(alloc.master)) fs.createFile(alloc.master, new Uint8Array(), 0o666);
                if (!fs.getNode(alloc.slave)) fs.createFile(alloc.slave, new Uint8Array(), 0o666);
                ptyId = alloc.id;
                void kernel.spawn(`bash tty${alloc.id}`, { tty: alloc.slave });
                setInterval(() => {
                    if (ptyId === null) return;
                    const out = ptys.read(ptyId, "master", 1024);
                    if (out.length > 0) conn.write(out);
                }, 10);
            }

            conn.onData((data) => {
                if (stage === "shell") {
                    if (ptyId !== null) ptys.write(ptyId, "master", data);
                    return;
                }
                const text = dec.decode(data);
                for (const ch of text) {
                    if (stage === "user") {
                        if (ch === "\n") {
                            stage = "pass";
                            conn.write(enc.encode("password: "));
                        } else {
                            user += ch;
                        }
                    } else if (stage === "pass") {
                        if (ch === "\n") {
                            stage = "shell";
                            conn.write(enc.encode("\nWelcome to Helios-OS\n"));
                            startShell();
                        } else {
                            pass += ch;
                        }
                    }
                }
            });
        },
    });
}
