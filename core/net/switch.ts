import { NIC, Frame } from "./nic";

export class Switch {
    private ports: NIC[] = [];
    private cam = new Map<string, NIC>();

    connect(nic: NIC) {
        this.ports.push(nic);
    }

    tick() {
        for (const nic of this.ports) {
            let frame: Frame | undefined;
            while ((frame = nic.tx.shift())) {
                this.cam.set(frame.src, nic);
                const dst = this.cam.get(frame.dst);
                if (dst) {
                    dst.rx.push(frame);
                } else {
                    for (const other of this.ports) {
                        if (other !== nic) other.rx.push(frame);
                    }
                }
            }
        }
    }
}
