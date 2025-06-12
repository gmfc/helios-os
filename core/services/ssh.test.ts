import assert from "assert";
import { describe, it } from "vitest";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { TCP } from "../net/tcp";
import { startSshd } from "./ssh";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("SSH service", () => {
    it("spawns a shell after login", async () => {
        const tcp = new TCP();
        const k1 = kernelTest!.createKernel(new InMemoryFileSystem());
        const k2 = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(k1).tcp = tcp;
        kernelTest!.getState(k2).tcp = tcp;

        let spawned = false;
        (k1 as any).spawn = async () => {
            spawned = true;
            return 0;
        };

        startSshd(k1, { port: 2222 });

        const conn = tcp.connect("127.0.0.1", 2222);
        let buf = "";
        conn.onData((d) => {
            buf += dec.decode(d);
        });

        await new Promise((r) => setTimeout(r, 50));
        conn.write(enc.encode("user\n"));
        await new Promise((r) => setTimeout(r, 20));
        conn.write(enc.encode("pass\n"));
        await new Promise((r) => setTimeout(r, 50));

        assert(spawned, "spawn called");
    });
});

