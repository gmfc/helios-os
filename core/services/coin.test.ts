import assert from "assert";
import { describe, it } from "vitest";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { UDP } from "../net/udp";
import { startCoinService } from "./coin";

describe("Coin service", () => {
    it("consensus across kernels", async () => {
        const udp = new UDP();
        const k1 = kernelTest!.createKernel(new InMemoryFileSystem());
        const k2 = kernelTest!.createKernel(new InMemoryFileSystem());
        const k3 = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(k1).udp = udp;
        kernelTest!.getState(k2).udp = udp;
        kernelTest!.getState(k3).udp = udp;

        const s1 = startCoinService(k1, {
            port: 4001,
            peers: [
                { ip: "127.0.0.1", port: 4002 },
                { ip: "127.0.0.1", port: 4003 },
            ],
            difficulty: 1,
        });
        const s2 = startCoinService(k2, {
            port: 4002,
            peers: [
                { ip: "127.0.0.1", port: 4001 },
                { ip: "127.0.0.1", port: 4003 },
            ],
            difficulty: 1,
        });
        const s3 = startCoinService(k3, {
            port: 4003,
            peers: [
                { ip: "127.0.0.1", port: 4001 },
                { ip: "127.0.0.1", port: 4002 },
            ],
            difficulty: 1,
        });

        await new Promise((r) => setTimeout(r, 10));

        s1.mine("one");
        await new Promise((r) => setTimeout(r, 20));
        s1.mine("two");
        await new Promise((r) => setTimeout(r, 20));
        s1.mine("three");
        await new Promise((r) => setTimeout(r, 50));

        assert.strictEqual(s1.chain.length, 4);
        assert.strictEqual(s2.chain.length, 4);
        assert.strictEqual(s3.chain.length, 4);
        assert.strictEqual(s1.chain[3].hash, s2.chain[3].hash);
        assert.strictEqual(s1.chain[3].hash, s3.chain[3].hash);
    });
});
