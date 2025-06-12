import assert from "assert";
import { describe, it } from "vitest";
import { InMemoryFileSystem } from "../fs";
import { kernelTest } from "../kernel";
import { TCP } from "../net/tcp";
import { startImapd } from "./imap";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("IMAP service", () => {
    it("lists and retrieves mail", async () => {
        const k1 = kernelTest!.createKernel(new InMemoryFileSystem());
        const k2 = kernelTest!.createKernel(new InMemoryFileSystem());
        const tcp = new TCP();
        kernelTest!.getState(k1).tcp = tcp;
        kernelTest!.getState(k2).tcp = tcp;

        const fs1 = kernelTest!.getState(k1).fs as InMemoryFileSystem;
        fs1.createDirectory("/var", 0o755);
        fs1.createDirectory("/var/mail", 0o755);
        fs1.createDirectory("/var/mail/bob", 0o755);
        fs1.createFile("/var/mail/bob/msg.txt", "hello", 0o644);

        startImapd(k1, { port: 2143 });

        const conn = tcp.connect("127.0.0.1", 2143);
        let buf = "";
        conn.onData((d) => {
            buf += dec.decode(d);
        });

        conn.write(enc.encode("LIST bob\r\n"));
        await new Promise((r) => setTimeout(r, 10));
        assert(buf.includes("msg.txt"), "LIST output");
        buf = "";
        conn.write(enc.encode("RETR bob msg.txt\r\n"));
        await new Promise((r) => setTimeout(r, 10));
        assert(buf.includes("hello"), "RETR output");
    });
});
