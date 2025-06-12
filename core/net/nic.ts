import { invoke } from "@tauri-apps/api/core";

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
        public netmask?: string,
        public status: "up" | "down" = "down",
        public ssid?: string,
    ) {
        invoke("register_nic", { id, mac }).catch(() => {});
    }

    send(frame: Frame) {
        this.tx.push(frame);
        invoke("send_frame", {
            nicId: this.id,
            frame: { src: frame.src, dst: frame.dst, payload: Array.from(frame.payload) },
        }).catch(() => {});
    }

    async receive(): Promise<Frame | undefined> {
        if (this.rx.length === 0) {
            try {
                const frames: any[] = await invoke("receive_frames", { nicId: this.id });
                if (Array.isArray(frames)) {
                    for (const f of frames) {
                        this.rx.push({
                            src: String(f.src),
                            dst: String(f.dst),
                            payload: new Uint8Array(f.payload as number[]),
                        });
                    }
                }
            } catch {}
        }
        return this.rx.shift();
    }
}
