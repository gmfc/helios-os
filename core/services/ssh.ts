import { Kernel, TcpConnection } from "../kernel";

export interface SshOptions {
    port?: number;
}

export function startSshd(kernel: Kernel, opts: SshOptions = {}): void {
    const port = opts.port ?? 22;
    const greeting = new TextEncoder().encode("Welcome to Helios SSH\n");
    kernel.registerService(`sshd:${port}`, port, "tcp", {
        onConnect(conn: TcpConnection) {
            conn.write(greeting);
            conn.onData((data) => {
                const cmd = new TextDecoder().decode(data).trim();
                if (cmd.length === 0) return;
                const resp = new TextEncoder().encode("Unknown command\n");
                conn.write(resp);
            });
        },
    });
}
