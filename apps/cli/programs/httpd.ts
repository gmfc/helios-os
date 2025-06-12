import type { SyscallDispatcher } from "../../types/syscalls";
import { join, normalize } from "path";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const port = argv[0] ? parseInt(argv[0], 10) : 80;
    const root = argv[1] ?? "/var/www";
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    async function readFile(path: string): Promise<Uint8Array> {
        const fd = await syscall("open", path, "r");
        const chunks: Uint8Array[] = [];
        while (true) {
            const chunk = await syscall("read", fd, 1024);
            if (chunk.length === 0) break;
            chunks.push(chunk);
        }
        await syscall("close", fd);
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
            buf.set(c, off);
            off += c.length;
        }
        return buf;
    }

    await syscall("listen", port, "tcp", (conn) => {
        let buffer = "";
        conn.onData((d) => {
            buffer += dec.decode(d);
            void processBuffer();
        });

        async function processBuffer() {
            while (true) {
                const idx = buffer.indexOf("\r\n\r\n");
                if (idx === -1) break;
                const raw = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 4);
                const lines = raw.split("\r\n");
                const [method, path] = lines[0].split(" ");
                const clean = path.split("?")[0] || "/";
                const filePath = clean === "/" ? "/index.html" : clean;
                const full = normalize(join(root, "." + filePath));
                if (!full.startsWith(normalize(root))) {
                    const body = "Forbidden";
                    const hdr = [
                        "HTTP/1.1 403 Forbidden",
                        `Content-Length: ${body.length}`,
                        "Connection: close",
                        "",
                        "",
                    ].join("\r\n");
                    conn.write(enc.encode(hdr));
                    if (method === "GET") conn.write(enc.encode(body));
                    continue;
                }
                try {
                    const data = await readFile(full);
                    const hdr = [
                        "HTTP/1.1 200 OK",
                        `Content-Length: ${data.length}`,
                        "Connection: keep-alive",
                        "",
                        "",
                    ].join("\r\n");
                    conn.write(enc.encode(hdr));
                    if (method === "GET") conn.write(data);
                } catch {
                    const body = "Not Found";
                    const hdr = [
                        "HTTP/1.1 404 Not Found",
                        `Content-Length: ${body.length}`,
                        "Connection: close",
                        "",
                        "",
                    ].join("\r\n");
                    conn.write(enc.encode(hdr));
                    if (method === "GET") conn.write(enc.encode(body));
                }
            }
        }
    });

    return 0;
}


