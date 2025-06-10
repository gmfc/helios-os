export interface Frame {
    src: string;
    dst: string;
    payload: Uint8Array;
}

export class NIC {
    public rx: Frame[] = [];
    public tx: Frame[] = [];

    constructor(
        public id: string,
        public mac: string,
        public ip?: string,
    ) {}

    send(frame: Frame) {
        this.tx.push(frame);
    }

    receive(): Frame | undefined {
        return this.rx.shift();
    }
}
