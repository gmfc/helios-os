import assert from "assert";
import { describe, it } from "vitest";
import * as hostfs from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { startHttpd } from "./http";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("HTTP service", () => {
    it("serves index.html", async () => {
        const rootDir = path.join(tmpdir(), "www");
        await hostfs.mkdir(rootDir, { recursive: true });
        await hostfs.writeFile(path.join(rootDir, "index.html"), "hello world");
        const kernel = kernelTest!.createKernel(new InMemoryFileSystem());
        startHttpd(kernel, { port: 8080, root: rootDir });
        const conn = (kernel as any).state.tcp.connect("127.0.0.1", 8080);
        let resp = "";
        conn.onData((d) => {
            resp += dec.decode(d);
        });
        conn.write(enc.encode("GET /index.html HTTP/1.1\r\nHost: localhost\r\n\r\n"));
        await new Promise((r) => setTimeout(r, 10));
        assert(resp.includes("200 OK"), "status 200");
        assert(resp.includes("hello world"), "body served");
        assert(resp.includes("Content-Type: text/html"));
        const log = dec.decode(await (kernelTest!.getState(kernel).fs as InMemoryFileSystem).read("/var/log/httpd"));
        assert(log.includes("/index.html"));
        await hostfs.rm(rootDir, { recursive: true, force: true });
    });
});
