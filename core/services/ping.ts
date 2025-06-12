import { Kernel, UdpConnection } from "../kernel";

export interface PingOptions {
    port?: number;
}

export function startPingService(kernel: Kernel, opts: PingOptions = {}): void {
    const port = opts.port ?? 0;
    kernel.registerService(`pingd:${port}`, port, "udp", {
        onConnect(conn: UdpConnection) {
            conn.onData((data) => {
                conn.write(data);
            });
        },
    });
}

