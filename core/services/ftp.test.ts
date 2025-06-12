import assert from "assert";
import { describe, it } from "vitest";
import { TCP } from "../net/tcp";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { startFtpd } from "./ftp";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("FTP service", () => {
    it("transfers a file between kernels", async () => {
        const k1 = kernelTest!.createKernel(new InMemoryFileSystem());
        const k2 = kernelTest!.createKernel(new InMemoryFileSystem());
        const shared = new TCP();
        kernelTest!.getState(k1).tcp = shared;
        kernelTest!.getState(k2).tcp = shared;

        const fs1 = kernelTest!.getState(k1).fs as InMemoryFileSystem;
        fs1.createDirectory("/srv", 0o755);
        fs1.createFile("/srv/hello.txt", "hi", 0o644);

        startFtpd(k1, { port: 2121, root: "/srv" });

        let data = "";
        kernelTest!.getState(k2).tcp.listen(2020, (conn) => {
            conn.onData((d) => {
                data += dec.decode(d);
            });
        });

        const ctl = shared.connect("127.0.0.1", 2121);
        ctl.write(enc.encode("USER a\r\n"));
        ctl.write(enc.encode("PASS b\r\n"));
        ctl.write(enc.encode("PORT 127,0,0,1,7,228\r\n"));
        ctl.write(enc.encode("RETR hello.txt\r\n"));

        await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(data, "hi", "retrieved file contents");

        let storConn: any = null;
        kernelTest!.getState(k2).tcp.listen(2021, (conn) => {
            storConn = conn;
        });
        ctl.write(enc.encode("PORT 127,0,0,1,7,229\r\n"));
        ctl.write(enc.encode("STOR upload.txt\r\n"));
        await new Promise((r) => setTimeout(r, 5));
        storConn.write(enc.encode("bye"));
        await new Promise((r) => setTimeout(r, 20));
        const uploaded = await fs1.read("/srv/upload.txt");
        assert.strictEqual(dec.decode(uploaded), "bye", "stored file contents");
    });
});

