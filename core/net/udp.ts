export type UdpHandler = (conn: UdpConnection) => void;

export class UdpConnection {
    private handlers: Array<(data: Uint8Array) => void> = [];

    constructor(
        private udp: UDP,
        public readonly id: number,
        public readonly ip: string,
        public readonly port: number,
    ) {}

    write(data: Uint8Array): void {
        this.udp.send(this.id, data);
    }

    onData(handler: (data: Uint8Array) => void): void {
        this.handlers.push(handler);
    }

    _handle(data: Uint8Array): void {
        for (const h of this.handlers) h(data);
    }
}

export class UDP {
    private listeners = new Map<number, UdpHandler>();
    private connections = new Map<number, UdpConnection>();
    private peers = new Map<number, number>();
    private nextSocket = 1;

    listen(port: number, handler: UdpHandler): number {
        this.listeners.set(port, handler);
        return port;
    }

    unlisten(port: number): void {
        this.listeners.delete(port);
    }

    connect(ip: string, port: number): UdpConnection {
        const clientId = this.nextSocket++;
        const serverId = this.nextSocket++;
        const client = new UdpConnection(this, clientId, ip, port);
        const server = new UdpConnection(this, serverId, "127.0.0.1", port);
        this.connections.set(clientId, client);
        this.connections.set(serverId, server);
        this.peers.set(clientId, serverId);
        this.peers.set(serverId, clientId);
        const handler = this.listeners.get(port);
        if (handler) handler(server);
        return client;
    }

    send(sock: number, data: Uint8Array): void {
        const peerId = this.peers.get(sock);
        if (peerId === undefined) return;
        const peer = this.connections.get(peerId);
        peer?._handle(data);
    }
}
