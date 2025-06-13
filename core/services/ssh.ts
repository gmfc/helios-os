import { Kernel, TcpConnection } from "../kernel";
import type { AsyncFileSystem } from "../fs/async";

export interface SshOptions {
    port?: number;
}

export function startSshd(kernel: Kernel, opts: SshOptions = {}): void {
    const port = opts.port ?? 22;
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const fs = kernel.state.fs as AsyncFileSystem;

    async function checkPassword(u: string, p: string): Promise<boolean> {
        try {
            const data = await fs.read("/etc/passwd");
            const text = dec.decode(data);
            for (const line of text.split(/\r?\n/)) {
                const [user, pass] = line.split(":");
                if (user === u && pass === p) return true;
            }
        } catch {}
        return false;
    }

    async function checkKey(u: string, key: string): Promise<boolean> {
        const paths = [`/home/${u}/.ssh/authorized_keys`, "/etc/ssh/authorized_keys"];
        for (const path of paths) {
            try {
                const data = await fs.read(path);
                const text = dec.decode(data);
                for (const line of text.split(/\r?\n/)) {
                    if (line.trim() === key.trim()) return true;
                }
            } catch {}
        }
        return false;
    }

    kernel.registerService(`sshd:${port}`, port, "tcp", {
        onConnect(conn: TcpConnection) {
            conn.write(enc.encode("login: "));
            let stage: "user" | "pass" | "shell" = "user";
            let user = "";
            let pass = "";
            let ptyId: number | null = null;
            let pty: { read(len: number): Uint8Array; write(data: Uint8Array): void } | null = null;

            function startShell() {
                const alloc = kernel.allocatePty();
                ptyId = alloc.id;
                pty = kernel.openPty(alloc.id, "master");
                void kernel.spawn(`bash tty${alloc.id}`, { tty: alloc.slave });
                setInterval(() => {
                    if (!pty) return;
                    const out = pty.read(1024);
                    if (out.length > 0) conn.write(out);
                }, 10);
            }

            conn.onData((data) => {
                if (stage === "shell") {
                    if (pty) pty.write(data);
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
                            (async () => {
                                let ok = false;
                                if (pass.trim().startsWith("ssh-")) {
                                    ok = await checkKey(user.trim(), pass.trim());
                                } else {
                                    ok = await checkPassword(user.trim(), pass.trim());
                                }
                                if (ok) {
                                    stage = "shell";
                                    conn.write(enc.encode("\nWelcome to Helios-OS\n"));
                                    startShell();
                                } else {
                                    user = "";
                                    pass = "";
                                    stage = "user";
                                    conn.write(enc.encode("\nLogin incorrect\nlogin: "));
                                }
                            })();
                        } else {
                            pass += ch;
                        }
                    }
                }
            });
        },
    });
}
