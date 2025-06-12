import { Kernel, TcpConnection } from "../kernel";
import * as fs from "fs/promises";
import { join, normalize } from "path";

export interface HttpRequest {
    method: string;
    path: string;
    version: string;
    headers: Record<string, string>;
}

export interface HttpOptions {
    port?: number;
    root?: string;
    handler?: (req: HttpRequest, conn: TcpConnection) => void | Promise<void>;
}

export function startHttpd(kernel: Kernel, opts: HttpOptions = {}): void {
    const port = opts.port ?? 80;
    const root = opts.root ?? "/var/www";
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const defaultHandler = async (req: HttpRequest, conn: TcpConnection) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
            const body = "Not Implemented";
            const headers = [
                "HTTP/1.1 501 Not Implemented",
                `Content-Length: ${body.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            conn.write(enc.encode(headers));
            if (req.method === "GET") conn.write(enc.encode(body));
            return;
        }

        const clean = req.path.split("?")[0] || "/";
        const filePath = clean === "/" ? "/index.html" : clean;
        const full = normalize(join(root, "." + filePath));
        if (!full.startsWith(normalize(root))) {
            const body = "Forbidden";
            const headers = [
                "HTTP/1.1 403 Forbidden",
                `Content-Length: ${body.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            conn.write(enc.encode(headers));
            if (req.method === "GET") conn.write(enc.encode(body));
            return;
        }

        try {
            const data = await fs.readFile(full);
            const headers = [
                "HTTP/1.1 200 OK",
                `Content-Length: ${data.length}`,
                "Connection: keep-alive",
                "",
                "",
            ].join("\r\n");
            conn.write(enc.encode(headers));
            if (req.method === "GET") conn.write(data);
        } catch {
            const body = "Not Found";
            const headers = [
                "HTTP/1.1 404 Not Found",
                `Content-Length: ${body.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            conn.write(enc.encode(headers));
            if (req.method === "GET") conn.write(enc.encode(body));
        }
    };

    const handler = opts.handler ?? defaultHandler;

    kernel.registerService(`httpd:${port}`, port, "tcp", {
        onConnect(conn: TcpConnection) {
            let buffer = "";
            conn.onData((data) => {
                buffer += dec.decode(data);
                processBuffer();
            });

            function processBuffer() {
                while (true) {
                    const idx = buffer.indexOf("\r\n\r\n");
                    if (idx === -1) break;
                    const raw = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 4);
                    const lines = raw.split("\r\n");
                    const [method, path, version] = lines[0].split(" ");
                    const headers: Record<string, string> = {};
                    for (let i = 1; i < lines.length; i++) {
                        const [key, ...rest] = lines[i].split(":");
                        headers[key.trim().toLowerCase()] = rest.join(":").trim();
                    }
                    const req: HttpRequest = { method, path, version, headers };
                    void Promise.resolve(handler(req, conn));
                }
            }
        },
    });
}
