import assert from "assert";
import { describe, it } from "vitest";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { UDP } from "../net/udp";
import { startPingService } from "./ping";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("Ping service", () => {
    it("echoes UDP packets", async () => {
        const udp = new UDP();
        const k1 = kernelTest!.createKernel(new InMemoryFileSystem());
        const k2 = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(k1).udp = udp;
        kernelTest!.getState(k2).udp = udp;

        startPingService(k1, { port: 9999 });

        const conn = udp.connect("127.0.0.1", 9999);
        let resp = "";
        conn.onData((d) => {
            resp += dec.decode(d);
        });
        conn.write(enc.encode("hi"));
        await new Promise((r) => setTimeout(r, 10));
        assert.strictEqual(resp, "hi");
    });
});
