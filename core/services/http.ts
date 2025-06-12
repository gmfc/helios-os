import { Kernel, TcpConnection } from "../kernel";

export interface HttpOptions {
    port?: number;
}

export function startHttpd(kernel: Kernel, opts: HttpOptions = {}): void {
    const port = opts.port ?? 80;
    kernel.registerService(`httpd:${port}`, port, "tcp", {
        onConnect(conn: TcpConnection) {
            conn.onData((data) => {
                void new TextDecoder().decode(data);
                const response = `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nHello from Helios HTTP on port ${port}\n`;
                conn.write(new TextEncoder().encode(response));
            });
        },
    });
}
