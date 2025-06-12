import assert from "assert";
import { describe, it } from "vitest";
import { kernelTest } from "../kernel";
import { InMemoryFileSystem } from "../fs";
import { NIC } from "./nic";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

interface Frame { src: string; dst: string; payload: number[]; }

describe("NIC hub", () => {
    it("forwards frames between kernels", async () => {
        // required by tauri API mocks
        // @ts-ignore
        globalThis.window = {} as any;
        const nicsById = new Map<string, { mac: string; frames: Frame[] }>();
        const macToId = new Map<string, string>();
        mockIPC((cmd, args) => {
            if (cmd === "register_nic") {
                nicsById.set(args.id, { mac: args.mac, frames: [] });
                macToId.set(args.mac, args.id);
                return null;
            }
            if (cmd === "send_frame") {
                const info = nicsById.get(args.nicId);
                if (!info) return null;
                const frame: Frame = args.frame;
                const dstId = macToId.get(frame.dst);
                if (dstId && nicsById.has(dstId)) {
                    nicsById.get(dstId)!.frames.push(frame);
                } else {
                    for (const [id, q] of nicsById) {
                        if (id !== args.nicId) q.frames.push(frame);
                    }
                }
                return null;
            }
            if (cmd === "receive_frames") {
                const info = nicsById.get(args.nicId);
                if (!info) return [];
                const out = info.frames.slice();
                info.frames.length = 0;
                return out;
            }
            return null;
        });

        const k1 = kernelTest!.createKernel(new InMemoryFileSystem());
        k1.startNetworking();
        kernelTest!.syscall_create_nic(k1, "eth0", "AA");
        const nic1 = kernelTest!.getState(k1).nics.get("eth0") as NIC;

        const k2 = kernelTest!.createKernel(new InMemoryFileSystem());
        k2.startNetworking();
        kernelTest!.syscall_create_nic(k2, "eth0", "BB");
        const nic2 = kernelTest!.getState(k2).nics.get("eth0") as NIC;

        nic1.send({ src: "AA", dst: "BB", payload: new Uint8Array([1]) });
        const frame = await nic2.receive();
        clearMocks();
        // @ts-ignore
        delete globalThis.window;
        assert(frame && frame.payload[0] === 1, "frame received through hub");
    });
});

