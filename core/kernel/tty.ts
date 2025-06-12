export type TtySide = "master" | "slave";

class Pty {
    public masterBuffer: number[] = [];
    public slaveBuffer: number[] = [];
    public masterWaiters: Array<() => void> = [];
    public slaveWaiters: Array<() => void> = [];
    constructor(public id: number) {}
}

export class PtyManager {
    private nextId = 0;
    private ptys: Map<number, Pty> = new Map();

    allocate(): { id: number; master: string; slave: string } {
        const id = this.nextId++;
        const pty = new Pty(id);
        this.ptys.set(id, pty);
        return { id, master: `/dev/pty${id}`, slave: `/dev/tty${id}` };
    }

    exists(id: number): boolean {
        return this.ptys.has(id);
    }

    write(id: number, side: TtySide, data: Uint8Array): void {
        const pty = this.ptys.get(id);
        if (!pty) return;
        const target = side === "master" ? pty.slaveBuffer : pty.masterBuffer;
        const waiters =
            side === "master" ? pty.slaveWaiters : pty.masterWaiters;
        for (const b of data) target.push(b);
        while (waiters.length > 0) {
            const w = waiters.shift();
            if (w) w();
        }
    }

    read(id: number, side: TtySide, length: number): Uint8Array {
        const pty = this.ptys.get(id);
        if (!pty) return new Uint8Array();
        const buf = side === "master" ? pty.masterBuffer : pty.slaveBuffer;
        const out: number[] = buf.splice(0, length);
        return Uint8Array.from(out);
    }

    wait(id: number, side: TtySide): Promise<void> {
        const pty = this.ptys.get(id);
        if (!pty) return Promise.resolve();
        const buf = side === "master" ? pty.masterBuffer : pty.slaveBuffer;
        if (buf.length > 0) return Promise.resolve();
        return new Promise((resolve) => {
            const waiters =
                side === "master" ? pty.masterWaiters : pty.slaveWaiters;
            waiters.push(resolve);
        });
    }
}
