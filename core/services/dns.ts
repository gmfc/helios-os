import { Kernel, UdpConnection } from "../kernel";
import type { AsyncFileSystem } from "../fs/async";

export interface DnsOptions {
    port?: number;
    zoneFile?: string;
    upstream?: { ip: string; port: number };
}

interface CacheEntry {
    ip: string;
    expires: number;
}

interface Question {
    name: string;
    type: number;
    cls: number;
}

function readName(buf: Uint8Array, offset: number): [string, number] {
    const parts: string[] = [];
    while (true) {
        const len = buf[offset++];
        if (len === 0) break;
        parts.push(new TextDecoder().decode(buf.slice(offset, offset + len)));
        offset += len;
    }
    return [parts.join("."), offset];
}

function writeName(name: string): Uint8Array {
    const parts = name.split(".");
    const pieces: number[] = [];
    for (const p of parts) {
        pieces.push(p.length);
        for (let i = 0; i < p.length; i++) pieces.push(p.charCodeAt(i));
    }
    pieces.push(0);
    return new Uint8Array(pieces);
}

function buildQuery(id: number, name: string): Uint8Array {
    const qname = writeName(name);
    const buf = new Uint8Array(12 + qname.length + 4);
    const view = new DataView(buf.buffer);
    view.setUint16(0, id);
    view.setUint16(2, 0x0100); // recursion desired
    view.setUint16(4, 1); // qdcount
    view.setUint16(6, 0); // ancount
    view.setUint16(8, 0); // nscount
    view.setUint16(10, 0); // arcount
    buf.set(qname, 12);
    view.setUint16(12 + qname.length, 1); // type A
    view.setUint16(14 + qname.length, 1); // class IN
    return buf;
}

function parseQuestion(buf: Uint8Array): { id: number; q: Question } | null {
    if (buf.length < 17) return null;
    const view = new DataView(buf.buffer);
    const id = view.getUint16(0);
    const qd = view.getUint16(4);
    if (qd === 0) return null;
    let off = 12;
    const [name, next] = readName(buf, off);
    off = next;
    const type = view.getUint16(off);
    off += 2;
    const cls = view.getUint16(off);
    return { id, q: { name, type, cls } };
}

function buildResponse(id: number, q: Question, ip: string | null): Uint8Array {
    const qname = writeName(q.name);
    const buf = new Uint8Array(
        12 + qname.length + 4 + (ip ? qname.length + 10 + 4 : 0),
    );
    const view = new DataView(buf.buffer);
    view.setUint16(0, id);
    view.setUint16(2, 0x8180); // standard response, recursion available
    view.setUint16(4, 1); // qdcount
    view.setUint16(6, ip ? 1 : 0); // ancount
    view.setUint16(8, 0); // nscount
    view.setUint16(10, 0); // arcount
    buf.set(qname, 12);
    view.setUint16(12 + qname.length, q.type);
    view.setUint16(14 + qname.length, q.cls);
    if (ip) {
        const off = 12 + qname.length + 4;
        buf.set(qname, off);
        const view2 = new DataView(buf.buffer);
        const ipOff = off + qname.length;
        view2.setUint16(ipOff, 1); // type A
        view2.setUint16(ipOff + 2, 1); // class IN
        view2.setUint32(ipOff + 4, 60); // ttl
        view2.setUint16(ipOff + 8, 4); // rdlength
        const [a, b, c, d] = ip.split(".").map((n) => parseInt(n, 10));
        buf[ipOff + 10] = a;
        buf[ipOff + 11] = b;
        buf[ipOff + 12] = c;
        buf[ipOff + 13] = d;
    }
    return buf;
}

export async function startNamed(kernel: Kernel, opts: DnsOptions = {}): Promise<void> {
    const port = opts.port ?? 53;
    const zoneFile = opts.zoneFile ?? "/etc/named.zone";
    const fs = kernel.state.fs as AsyncFileSystem;
    const zone = new Map<string, string>();
    const cache = new Map<string, CacheEntry>();

    try {
        const data = await fs.read(zoneFile);
        const text = new TextDecoder().decode(data);
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
                const name = parts[0].toLowerCase();
                const ip = parts[parts.length - 1];
                zone.set(name.replace(/\.$/, ""), ip);
            }
        }
    } catch {}

    async function resolveExternal(name: string): Promise<string | null> {
        if (!opts.upstream) return null;
        const conn = kernel.state.udp.connect(opts.upstream.ip, opts.upstream.port);
        const id = Math.floor(Math.random() * 65535);
        const query = buildQuery(id, name);
        return await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), 50);
            conn.onData((d) => {
                const parsed = parseQuestion(d);
                if (!parsed || parsed.id !== id) return;
                const view = new DataView(d.buffer);
                let off = 12;
                const [_, next] = readName(d, off);
                off = next + 4; // skip question
                if (view.getUint16(6) === 0) {
                    clearTimeout(timer);
                    resolve(null);
                    return;
                }
                const [aname, off2] = readName(d, off);
                off = off2;
                const type = view.getUint16(off);
                const cls = view.getUint16(off + 2);
                const rdlen = view.getUint16(off + 8);
                if (type === 1 && cls === 1 && rdlen === 4) {
                    const ip = `${d[off + 10]}.${d[off + 11]}.${d[off + 12]}.${d[off + 13]}`;
                    cache.set(name, { ip, expires: Date.now() + 60000 });
                    clearTimeout(timer);
                    resolve(ip);
                } else {
                    clearTimeout(timer);
                    resolve(null);
                }
            });
            conn.write(query);
        });
    }

    kernel.registerService(`named:${port}`, port, "udp", {
        onConnect(conn: UdpConnection) {
            conn.onData(async (data) => {
                const parsed = parseQuestion(data);
                if (!parsed) return;
                const { id, q } = parsed;
                if (q.type !== 1 || q.cls !== 1) return;
                const nameKey = q.name.toLowerCase();
                let ip = zone.get(nameKey);
                const cached = cache.get(nameKey);
                if (!ip && cached && cached.expires > Date.now()) {
                    ip = cached.ip;
                }
                if (!ip) {
                    ip = await resolveExternal(nameKey);
                }
                const resp = buildResponse(id, q, ip ?? null);
                conn.write(resp);
            });
        },
    });
}

