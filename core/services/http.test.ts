import assert from "assert";
import { describe, it } from "vitest";
import * as hostfs from "fs/promises";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { startHttpd } from "./http";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("HTTP service", () => {
    it("serves index.html", async () => {
        await hostfs.mkdir("/var/www", { recursive: true });
        await hostfs.writeFile("/var/www/index.html", "hello world");
        const kernel = kernelTest!.createKernel(new InMemoryFileSystem());
        startHttpd(kernel, { port: 8080 });
        const conn = (kernel as any).state.tcp.connect("127.0.0.1", 8080);
        let resp = "";
        conn.onData((d) => {
            resp += dec.decode(d);
        });
        conn.write(enc.encode("GET /index.html HTTP/1.1\r\nHost: localhost\r\n\r\n"));
        await new Promise((r) => setTimeout(r, 10));
        assert(resp.includes("200 OK"), "status 200");
        assert(resp.includes("hello world"), "body served");
        await hostfs.rm("/var/www/index.html");
    });
});
