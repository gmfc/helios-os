import { Kernel } from "../../core/kernel";
import { startSshd } from "../../core/services/ssh";

export async function runSshExample(kernel: Kernel) {
    startSshd(kernel, { port: 2222 });
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const conn = (kernel as any).tcp.connect("127.0.0.1", 2222);
    conn.onData((d: Uint8Array) => {
        console.log(dec.decode(d));
    });
    conn.write(enc.encode("user\n"));
    conn.write(enc.encode("pass\n"));
    setTimeout(() => {
        conn.write(enc.encode("echo hi\n"));
    }, 50);
}

