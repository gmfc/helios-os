import assert from "assert";
import { describe, it } from "vitest";
import { TCP } from "../net/tcp";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { startSmtpd } from "./smtp";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("SMTP service", () => {
    it("stores incoming mail", async () => {
        const fs = new InMemoryFileSystem();
        const k1 = kernelTest!.createKernel(fs);
        const k2 = kernelTest!.createKernel(new InMemoryFileSystem());
        const tcp = new TCP();
        kernelTest!.getState(k1).tcp = tcp;
        kernelTest!.getState(k2).tcp = tcp;

        startSmtpd(k1, { port: 2525, root: "/var/mail" });

        const conn = tcp.connect("127.0.0.1", 2525);
        conn.write(enc.encode("HELO a\r\n"));
        conn.write(enc.encode("MAIL FROM:<a@a>\r\n"));
        conn.write(enc.encode("RCPT TO:<bob>\r\n"));
        conn.write(enc.encode("DATA\r\n"));
        conn.write(enc.encode("hello world\r\n.\r\n"));
        await new Promise((r) => setTimeout(r, 20));

        const dir = await fs.readdir("/var/mail/bob");
        assert.strictEqual(dir.length, 1, "mail file created");
        const data = await fs.read(dir[0].path);
        assert.ok(dec.decode(data).includes("hello world"));
    });
});


