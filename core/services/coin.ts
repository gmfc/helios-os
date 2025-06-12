import { createHash } from "node:crypto";
import { Kernel, UdpConnection } from "../kernel";

export interface CoinOptions {
    port?: number;
    peers?: Array<{ ip: string; port: number }>;
    difficulty?: number;
}

export interface Block {
    index: number;
    prevHash: string;
    timestamp: number;
    data: string;
    nonce: number;
    hash: string;
}

export function startCoinService(kernel: Kernel, opts: CoinOptions = {}) {
    const port = opts.port ?? 3333;
    const peers = opts.peers ?? [];
    const difficulty = opts.difficulty ?? 1;
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const prefix = "0".repeat(difficulty);

    const genesis: Block = {
        index: 0,
        prevHash: "0",
        timestamp: 0,
        data: "genesis",
        nonce: 0,
        hash: createHash("sha256")
            .update("0" + "0" + "genesis" + 0)
            .digest("hex"),
    };

    const chain: Block[] = [genesis];
    const conns: UdpConnection[] = [];

    function calcHash(prevHash: string, ts: number, data: string, nonce: number) {
        return createHash("sha256")
            .update(`${prevHash}${ts}${data}${nonce}`)
            .digest("hex");
    }

    function verifyBlock(block: Block, prev: Block): boolean {
        const h = calcHash(prev.hash, block.timestamp, block.data, block.nonce);
        return (
            block.hash === h &&
            block.prevHash === prev.hash &&
            block.index === prev.index + 1 &&
            block.hash.startsWith(prefix)
        );
    }

    function verifyChain(ch: Block[]): boolean {
        if (ch.length === 0 || ch[0].hash !== genesis.hash) return false;
        for (let i = 1; i < ch.length; i++) {
            if (!verifyBlock(ch[i], ch[i - 1])) return false;
        }
        return true;
    }

    function addBlock(block: Block): boolean {
        const prev = chain[chain.length - 1];
        if (!verifyBlock(block, prev)) return false;
        chain.push(block);
        return true;
    }

    function broadcast(msg: unknown) {
        const data = enc.encode(JSON.stringify(msg));
        for (const c of conns) c.write(data);
    }

    function handle(conn: UdpConnection, raw: Uint8Array) {
        try {
            const msg = JSON.parse(dec.decode(raw));
            if (msg.type === "request_chain") {
                conn.write(enc.encode(JSON.stringify({ type: "chain", chain })));
            } else if (msg.type === "chain" && Array.isArray(msg.chain)) {
                if (msg.chain.length > chain.length && verifyChain(msg.chain)) {
                    chain.length = 0;
                    chain.push(...msg.chain);
                }
            } else if (msg.type === "block" && msg.block) {
                const added = addBlock(msg.block as Block);
                if (added) broadcast({ type: "block", block: msg.block });
                else conn.write(enc.encode(JSON.stringify({ type: "request_chain" })));
            }
        } catch {}
    }

    kernel.registerService(`coind:${port}`, port, "udp", {
        onConnect(conn) {
            conn.onData((d) => handle(conn, d));
        },
    });

    function connectPeers() {
        for (const p of peers) {
            const conn = kernel.state.udp.connect(p.ip, p.port);
            conns.push(conn);
            conn.onData((d) => handle(conn, d));
            conn.write(enc.encode(JSON.stringify({ type: "request_chain" })));
        }
    }

    setTimeout(connectPeers, 1);

    function mine(data: string): Block {
        const prev = chain[chain.length - 1];
        let nonce = 0;
        let ts = Date.now();
        let hash = "";
        while (true) {
            hash = calcHash(prev.hash, ts, data, nonce);
            if (hash.startsWith(prefix)) break;
            nonce++;
            ts = Date.now();
        }
        const block: Block = {
            index: prev.index + 1,
            prevHash: prev.hash,
            timestamp: ts,
            data,
            nonce,
            hash,
        };
        chain.push(block);
        broadcast({ type: "block", block });
        return block;
    }

    return {
        mine,
        get chain() {
            return chain;
        },
    };
}
