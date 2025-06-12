export const ICMP_ECHO_PORT = 0;

export type IcmpHandler = (
    data: Uint8Array,
    from: { ip: string }
) => Promise<Uint8Array | void> | Uint8Array | void;

export class ICMP {
    private handler: IcmpHandler | null = null;
    constructor(private udp: { listen: (p: number, h: IcmpHandler) => number; unlisten: (p: number) => void; connect: (ip: string, port: number) => number; send: (sock: number, data: Uint8Array) => Promise<Uint8Array | void>; }) {}

    listen(handler: IcmpHandler): number {
        this.handler = handler;
        return this.udp.listen(ICMP_ECHO_PORT, (d, src) => handler(d, { ip: src.ip }));
    }

    unlisten(): void {
        this.handler = null;
        this.udp.unlisten(ICMP_ECHO_PORT);
    }

    ping(ip: string, data: Uint8Array): Promise<Uint8Array | void> {
        const sock = this.udp.connect(ip, ICMP_ECHO_PORT);
        return this.udp.send(sock, data);
    }
}

