export type UdpHandler = (
    data: Uint8Array,
    from: { ip: string; port: number },
) => Promise<Uint8Array | void> | Uint8Array | void;

export class UDP {
    private listeners = new Map<number, UdpHandler>();
    private sockets = new Map<number, { ip: string; port: number }>();
    private nextSocket = 1;

    listen(port: number, handler: UdpHandler): number {
        this.listeners.set(port, handler);
        return port;
    }

    unlisten(port: number): void {
        this.listeners.delete(port);
    }

    connect(ip: string, port: number): number {
        const id = this.nextSocket++;
        this.sockets.set(id, { ip, port });
        return id;
    }

    async send(sock: number, data: Uint8Array): Promise<Uint8Array | void> {
        const dst = this.sockets.get(sock);
        if (!dst) return;
        const handler = this.listeners.get(dst.port);
        if (handler) {
            return await handler(data, { ip: "127.0.0.1", port: dst.port });
        }
    }
}
