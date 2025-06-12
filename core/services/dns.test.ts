import assert from "assert";
import { describe, it } from "vitest";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { UDP } from "../net/udp";
import { startNamed } from "./dns";

function buildQuery(id: number, name: string): Uint8Array {
    const parts = name.split(".");
    const pieces: number[] = [];
    for (const p of parts) {
        pieces.push(p.length);
        for (let i = 0; i < p.length; i++) pieces.push(p.charCodeAt(i));
    }
    pieces.push(0);
    const qname = new Uint8Array(pieces);
    const buf = new Uint8Array(12 + qname.length + 4);
    const view = new DataView(buf.buffer);
    view.setUint16(0, id);
    view.setUint16(2, 0x0100);
    view.setUint16(4, 1);
    view.setUint16(6, 0);
    view.setUint16(8, 0);
    view.setUint16(10, 0);
    buf.set(qname, 12);
    view.setUint16(12 + qname.length, 1);
    view.setUint16(14 + qname.length, 1);
    return buf;
}

function parseAnswer(buf: Uint8Array): string | null {
    if (buf.length < 33) return null;
    const view = new DataView(buf.buffer);
    const ancount = view.getUint16(6);
    if (ancount === 0) return null;
    let off = 12;
    while (buf[off] !== 0) off += buf[off] + 1;
    off += 1 + 2 + 2; // null byte + qtype + qclass
    // answer section
    while (buf[off] !== 0) off += buf[off] + 1;
    off += 1;
    off += 2; // type
    off += 2; // class
    off += 4; // ttl
    const rdlen = view.getUint16(off);
    off += 2;
    if (rdlen !== 4) return null;
    return `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`;
}

describe("DNS service", () => {
    it("resolves zone records", async () => {
        const udp = new UDP();
        const k1 = kernelTest!.createKernel(new InMemoryFileSystem());
        const k2 = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(k1).udp = udp;
        kernelTest!.getState(k2).udp = udp;

        const fs1 = kernelTest!.getState(k1).fs as InMemoryFileSystem;
        try {
            fs1.createDirectory("/etc", 0o755);
        } catch {}
        fs1.createFile("/etc/named.zone", "foo.test A 10.0.0.1", 0o644);

        await startNamed(k1);

        const conn = udp.connect("127.0.0.1", 53);
        let answer: string | null = null;
        conn.onData((d) => {
            answer = parseAnswer(d);
        });
        conn.write(buildQuery(1, "foo.test"));
        await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(answer, "10.0.0.1");
    });
});
