import assert from "assert";
import { describe, it } from "vitest";
import { InMemoryFileSystem } from "./fs";
import { kernelTest } from "./kernel";
import { NIC } from "./net/nic";

describe("Route syscalls", () => {
    it("add and delete routes affect forwarding", () => {
        const k = kernelTest!.createKernel(new InMemoryFileSystem());
        k.startNetworking();
        kernelTest!.syscall_create_nic(k, "eth0", "AA");
        kernelTest!.syscall_create_nic(k, "eth1", "BB");
        kernelTest!.syscall_route_add(k, "192.168.1.0/24", "eth1");
        const router = kernelTest!.getRouter(k);
        const frame = { src: "10.0.0.1", dst: "192.168.1.5", payload: new Uint8Array([1]) };
        router.forward(frame);
        const nic1 = kernelTest!.getState(k).nics.get("eth1") as NIC;
        assert(nic1.rx.length === 1, "frame forwarded on add");
        kernelTest!.syscall_route_del(k, "192.168.1.0/24");
        const frame2 = { src: "10.0.0.1", dst: "192.168.1.6", payload: new Uint8Array([2]) };
        router.forward(frame2);
        assert(nic1.rx.length === 1, "frame dropped after delete");
    });

    it("route lookup uses first match", () => {
        const k = kernelTest!.createKernel(new InMemoryFileSystem());
        k.startNetworking();
        kernelTest!.syscall_create_nic(k, "eth0", "AA");
        kernelTest!.syscall_create_nic(k, "eth1", "BB");
        kernelTest!.syscall_route_add(k, "192.168.1.0/24", "eth0");
        kernelTest!.syscall_route_add(k, "192.168.0.0/16", "eth1");
        const router = kernelTest!.getRouter(k);
        const frame = { src: "10.0.0.1", dst: "192.168.1.55", payload: new Uint8Array([5]) };
        router.forward(frame);
        const nic0 = kernelTest!.getState(k).nics.get("eth0") as NIC;
        const nic1 = kernelTest!.getState(k).nics.get("eth1") as NIC;
        assert.strictEqual(nic0.rx.length, 1, "specific route chosen");
        assert.strictEqual(nic1.rx.length, 0, "general route ignored");
    });
});

