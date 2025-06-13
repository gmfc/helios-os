import assert from "assert";
import { describe, it } from "vitest";
import { createHash } from "node:crypto";
import { Kernel, kernelTest } from "./kernel";
import { InMemoryFileSystem } from "./fs";

function checksum(obj: any): string {
    return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

describe("Kernel snapshots", () => {
    it("deterministic load", async () => {
        const kernel: any = new (Kernel as any)(new InMemoryFileSystem());
        const snap1 = kernel.snapshot();
        const restored1: any = await (Kernel as any).restore(snap1);
        const snap2 = restored1.snapshot();
        const restored2: any = await (Kernel as any).restore(snap2);
        const snap3 = restored2.snapshot();
        assert.strictEqual(
            checksum(snap2),
            checksum(snap3),
            "snapshot checksums must match",
        );
    });

    it("network snapshot restore", async () => {
        const netKernel: any = new (Kernel as any)(new InMemoryFileSystem());
        netKernel.startNetworking();
        (await import("./services")).startHttpd(netKernel, { port: 8080 });
        const conn = netKernel["state"].tcp.connect("127.0.0.1", 8080);
        conn.write(new Uint8Array([1, 2, 3]));
        const netSnap1 = netKernel.snapshot();
        const netRestored: any = await (Kernel as any).restore(netSnap1);
        netRestored.startNetworking();
        const netSnap2 = netRestored.snapshot();
        assert.strictEqual(
            checksum(netSnap1),
            checksum(netSnap2),
            "networked snapshot checksums must match",
        );
    });

    it("boot snapshot restores fs and processes", async () => {
        const kernel: any = new (Kernel as any)(new InMemoryFileSystem());
        const fs = kernel["state"].fs as InMemoryFileSystem;
        fs.createDirectory("/snap", 0o755);
        fs.createFile("/snap/file.txt", "data", 0o644);
        kernelTest!.createProcess(kernel);
        const snap1 = kernel.snapshot();
        const restored: any = await (Kernel as any).restore(snap1);
        const snap2 = restored.snapshot();
        assert.deepStrictEqual(snap1.fs, snap2.fs, "filesystem restored");
        assert.deepStrictEqual(
            snap1.processes,
            snap2.processes,
            "process table restored",
        );
    });
});
