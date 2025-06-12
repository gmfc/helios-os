export const ICMP_ECHO_PORT = 0;

export type IcmpHandler = (
    data: Uint8Array,
    from: { ip: string },
) => Promise<Uint8Array | void> | Uint8Array | void;

export class ICMP {
    private handler: IcmpHandler | null = null;
    constructor(
        private udp: {
            listen: (p: number, h: (conn: UdpConnection) => void) => number;
            unlisten: (p: number) => void;
            connect: (ip: string, port: number) => UdpConnection;
        },
    ) {}

    listen(handler: IcmpHandler): number {
        this.handler = handler;
        return this.udp.listen(ICMP_ECHO_PORT, (conn) => {
            conn.onData((d) => handler(d, { ip: conn.ip }));
        });
    }

    unlisten(): void {
        this.handler = null;
        this.udp.unlisten(ICMP_ECHO_PORT);
    }

    ping(ip: string, data: Uint8Array): Promise<Uint8Array | void> {
        const conn = this.udp.connect(ip, ICMP_ECHO_PORT);
        return new Promise((resolve) => {
            conn.onData((resp) => resolve(resp));
            conn.write(data);
        });
    }
}

