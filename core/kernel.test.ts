import assert from "assert";
import { describe, it, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { Kernel, kernelTest } from "./kernel";
import { eventBus } from "./utils/eventBus";
import { InMemoryFileSystem } from "./fs";
import {
    syscall_mkdir,
    syscall_unlink,
    syscall_rename,
    syscall_readdir,
    syscall_set_quota,
} from "./kernel/syscalls";
import * as fs from "fs/promises";
import path from "path";
import os from "os";

describe("Kernel", () => {
    let kernel: Kernel;

    beforeEach(() => {
        kernel = kernelTest!.createKernel(new InMemoryFileSystem());
    });

    afterEach(async () => {
        await kernel.stop();
    });

    it("scheduler stop", async () => {
        let ran = false;
        kernelTest!.setRunProcess(kernel, async (pcb: any) => {
            ran = true;
            pcb.exited = true;
        });
        await kernelTest!.syscall_spawn(kernel, "dummy");
        const startPromise = kernel.start();
        setTimeout(() => kernel.stop(), 10);
        await startPromise;
        assert(ran, "process should run");
    });

    it("mount and unmount", async () => {
        const img = new InMemoryFileSystem();
        img.createFile("/foo.txt", "bar", 0o644);
        const snap = img.getSnapshot();
        const tmp = path.join(os.tmpdir(), `test-${Date.now()}.vfs`);
        await fs.writeFile(tmp, JSON.stringify(snap));
        await kernelTest!.syscall_mount(kernel, tmp, "/mnt");
        assert(
            kernelTest!.getState(kernel).fs.getNode("/mnt/foo.txt"),
            "file mounted",
        );
        let mounts = await kernelTest!.getState(kernel).fs.read("/proc/mounts");
        let text = new TextDecoder().decode(mounts);
        assert(text.includes("/mnt"), "/proc/mounts lists mount");
        await assert.rejects(
            async () => {
                await kernelTest!.syscall_mount(kernel, tmp, "/mnt");
            },
            /EEXIST/,
        );
        await kernelTest!.syscall_unmount(kernel, "/mnt");
        assert(
            !kernelTest!.getState(kernel).fs.getNode("/mnt/foo.txt"),
            "file unmounted",
        );
        mounts = await kernelTest!.getState(kernel).fs.read("/proc/mounts");
        text = new TextDecoder().decode(mounts);
        assert(text === "", "mounts cleared after unmount");
        await fs.unlink(tmp);
    });

    it("opening directory throws EISDIR", async () => {
        const pid = kernelTest!.createProcess(kernel);
        const pcb = kernelTest!.getState(kernel).processes.get(pid)!;
        try {
            await kernelTest!.syscall_open(kernel, pcb, "/", "r");
            assert.fail("opening directory should throw");
        } catch (e: any) {
            assert(e.message.includes("EISDIR"), "EISDIR error expected");
        }
    });

    it("ps syscall returns processes", () => {
        const list = kernelTest!.syscall_ps(kernel);
        assert(
            Array.isArray(list) && list.length > 0,
            "ps should return processes",
        );
    });

    it("ps resource accumulation", async () => {
        const psKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        let runs = 0;
        kernelTest!.setRunProcess(psKernel, async (pcb: any) => {
            pcb.exitCode = 0;
            pcb.cpuMs += 5;
            pcb.memBytes += 1024;
            pcb.cpuHistory.push(5);
            runs++;
            if (runs >= 2) pcb.exited = true;
        });
        const psPid = await kernelTest!.syscall_spawn(psKernel, "dummy", {
            tty: "/dev/tty1",
        });
        const psPcb = kernelTest!.getState(psKernel).processes.get(psPid)!;
        await kernelTest!.runProcess(psKernel, psPcb);
        await kernelTest!.runProcess(psKernel, psPcb);
        const psList = kernelTest!.syscall_ps(psKernel);
        const proc = psList.find((p: any) => p.pid === psPid);
        assert(
            proc &&
                proc.cpuMs === 10 &&
                proc.memBytes === 2048 &&
                proc.tty === "/dev/tty1",
            "ps should return accumulated cpu/mem and tty",
        );
    });

    it("pty allocation and proc status", async () => {
        const ptyKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const pcb = kernelTest!.getState(ptyKernel).processes.get(1)!;
        const fd = await kernelTest!.syscall_open(
            ptyKernel,
            pcb,
            "/dev/ptmx",
            "rw",
        );
        const entry = pcb.fds.get(fd)!;
        const ttyPath = `/dev/tty${entry.ttyId}`;
        const pid = await kernelTest!.syscall_spawn(ptyKernel, "dummy", {
            tty: ttyPath,
        });
        const data = await kernelTest!
            .getState(ptyKernel)
            .fs.read(`/proc/${pid}/status`);
        const status = new TextDecoder().decode(data);
        assert(
            status.includes(`tty:\t${ttyPath}`),
            "process status should include tty",
        );
    });

    it("syscall permissions persist after restore", async () => {
        const permKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const pid2 = await kernelTest!.syscall_spawn(permKernel, "dummy", {
            syscalls: ["ps"],
        });
        const permSnap = permKernel.snapshot();
        const restored = await Kernel.restore(permSnap);
        const pcb2 = kernelTest!.getState(restored).processes.get(pid2)!;
        assert(
            pcb2.allowedSyscalls instanceof Set &&
                pcb2.allowedSyscalls.has("ps"),
            "permissions should persist after restore",
        );
    });

    it("open descriptors survive snapshot restore", async () => {
        const fdKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(fdKernel).fs.createDirectory("/tmp", 0o755);
        kernelTest!
            .getState(fdKernel)
            .fs.createFile("/tmp/foo.txt", "hello", 0o644);
        const pid3 = kernelTest!.createProcess(fdKernel);
        const pcb3 = kernelTest!.getState(fdKernel).processes.get(pid3)!;
        const fd = await kernelTest!.syscall_open(
            fdKernel,
            pcb3,
            "/tmp/foo.txt",
            "r",
        );
        const snapFd = fdKernel.snapshot();
        const restoredFd = await Kernel.restore(snapFd);
        const pcbRestored = kernelTest!
            .getState(restoredFd)
            .processes.get(pid3)!;
        const data = await kernelTest!.syscall_read(
            restoredFd,
            pcbRestored,
            fd,
            5,
        );
        assert(
            new TextDecoder().decode(data) === "hello",
            "open descriptor restored",
        );
    });

    it("scheduler timeslice requeues running process", async () => {
        globalThis.window = {} as any;
        globalThis.window.crypto = {
            getRandomValues: (arr: Uint32Array) =>
                require("crypto").randomFillSync(arr),
        };
        const { mockIPC, clearMocks } = await import("@tauri-apps/api/mocks");
        let slices = 0;
        mockIPC((_cmd, _args) => {
            slices++;
            if (slices < 3) {
                return { running: true, cpu_ms: 1, mem_bytes: 0 };
            }
            return { running: false, exit_code: 0, cpu_ms: 1, mem_bytes: 0 };
        });
        const schedKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        await kernelTest!.syscall_spawn(schedKernel, "dummy", { quotaMs: 1 });
        const schedStart = schedKernel.start();
        setTimeout(() => schedKernel.stop(), 10);
        await schedStart;
        clearMocks();
        // @ts-ignore
        delete globalThis.window;
        assert(slices >= 3, "process should be requeued multiple times");
    });

    it("persistent isolate accumulates resources", async () => {
        globalThis.window = {} as any;
        globalThis.window.crypto = {
            getRandomValues: (arr: Uint32Array) =>
                require("crypto").randomFillSync(arr),
        };
        const { mockIPC: mockPersist, clearMocks: clearPersist } = await import(
            "@tauri-apps/api/mocks"
        );
        const calls: any[] = [];
        mockPersist((cmd, args) => {
            if (cmd === "run_isolate_slice") {
                calls.push(args);
                if (calls.length === 1) {
                    return { running: true, cpu_ms: 2, mem_bytes: 100 };
                }
                return {
                    running: false,
                    exit_code: 0,
                    cpu_ms: 3,
                    mem_bytes: 150,
                };
            }
            return undefined;
        });
        const persistKernel = kernelTest!.createKernel(
            new InMemoryFileSystem(),
        );
        const persistPid = await kernelTest!.syscall_spawn(
            persistKernel,
            "dummy",
            { quotaMs: 1 },
        );
        const persistPcb = kernelTest!
            .getState(persistKernel)
            .processes.get(persistPid)!;
        await kernelTest!.runProcess(persistKernel, persistPcb);
        await kernelTest!.runProcess(persistKernel, persistPcb);
        clearPersist();
        // @ts-ignore
        delete globalThis.window;
        assert.strictEqual(calls.length, 2, "host called twice");
        assert("code" in calls[0], "first slice should include code");
        assert(!("code" in calls[1]), "subsequent slice should omit code");
        assert.strictEqual(persistPcb.cpuMs, 5, "CPU time accumulates");
        assert.strictEqual(
            persistPcb.memBytes,
            250,
            "memory usage accumulates",
        );
        assert.strictEqual(persistPcb.exited, true, "process should exit");
    });

    it("job table management", () => {
        const jobKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const jid = jobKernel.registerJob([123], "sleep 1");
        let jobList = kernelTest!.syscall_jobs(jobKernel);
        assert.strictEqual(jobList.length, 1, "job should register");
        assert.strictEqual(jobList[0].id, jid, "job id matches");
        jobKernel.updateJobStatus(jid, "Done");
        jobList = kernelTest!.syscall_jobs(jobKernel);
        assert.strictEqual(jobList[0].status, "Done", "status updates");
        jobKernel.removeJob(jid);
        assert.strictEqual(
            kernelTest!.syscall_jobs(jobKernel).length,
            0,
            "job removal",
        );
    });

    it("snapshot save/load", async () => {
        const snapKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(snapKernel).fs.createDirectory("/snap", 0o755);
        kernelTest!
            .getState(snapKernel)
            .fs.createFile("/snap/test.txt", "data", 0o644);
        const pcb = kernelTest!.getState(snapKernel).processes.get(1)!;
        kernelTest!.syscall_draw(
            snapKernel,
            pcb,
            new TextEncoder().encode("<p>hi</p>"),
            { title: "t" },
        );
        const hash1 = createHash("sha256")
            .update(
                JSON.stringify(
                    kernelTest!.getState(snapKernel).fs.getSnapshot(),
                ),
            )
            .digest("hex");
        const snapshot = snapKernel.snapshot();
        const restoredSnap = await Kernel.restore(snapshot);
        const hash2 = createHash("sha256")
            .update(
                JSON.stringify(
                    kernelTest!.getState(restoredSnap).fs.getSnapshot(),
                ),
            )
            .digest("hex");
        assert.strictEqual(
            hash1,
            hash2,
            "filesystem hash should match after restore",
        );
        assert.deepStrictEqual(
            kernelTest!.getState(restoredSnap).windows,
            kernelTest!.getState(snapKernel).windows,
            "windows should restore identically",
        );
    });

    it("/proc filesystem", async () => {
        const procKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const procPid = kernelTest!.createProcess(procKernel);
        const procPcb = kernelTest!
            .getState(procKernel)
            .processes.get(procPid)!;
        kernelTest!.getState(procKernel).fs.createDirectory("/tmp", 0o755);
        kernelTest!
            .getState(procKernel)
            .fs.createFile("/tmp/foo.txt", "bar", 0o644);
        const f = await kernelTest!.syscall_open(
            procKernel,
            procPcb,
            "/tmp/foo.txt",
            "r",
        );
        const fdList = await kernelTest!.syscall_readdir(
            procKernel,
            procPcb,
            `/proc/${procPid}/fd`,
        );
        assert(
            fdList.some((n: any) => n.path === `/proc/${procPid}/fd/${f}`),
            "/proc/<pid>/fd lists open descriptors",
        );
        const sfd = await kernelTest!.syscall_open(
            procKernel,
            procPcb,
            `/proc/${procPid}/status`,
            "r",
        );
        const stat = await kernelTest!.syscall_read(
            procKernel,
            procPcb,
            sfd,
            1024,
        );
        const text = new TextDecoder().decode(stat);
        assert(
            text.includes("pid\t" + procPid) ||
                text.includes("pid:\t" + procPid),
            "status file readable",
        );
        const cmdFd = await kernelTest!.syscall_open(
            procKernel,
            procPcb,
            `/proc/${procPid}/cmdline`,
            "r",
        );
        const cmdData = await kernelTest!.syscall_read(
            procKernel,
            procPcb,
            cmdFd,
            1024,
        );
        const cmdText = new TextDecoder().decode(cmdData);
        assert.strictEqual(cmdText, "", "cmdline should return empty string");
        try {
            await kernelTest!.syscall_open(
                procKernel,
                procPcb,
                `/proc/${procPid + 1}/status`,
                "r",
            );
            assert.fail("opening nonexistent /proc entry should throw");
        } catch (e: any) {
            assert(
                e.message.includes("ENOENT"),
                "ENOENT expected for missing process",
            );
        }
        try {
            await kernelTest!.syscall_open(
                procKernel,
                procPcb,
                `/proc/${procPid}/fd/${procPcb.nextFd}`,
                "r",
            );
            assert.fail("opening nonexistent fd should throw");
        } catch (e: any) {
            assert(
                e.message.includes("ENOENT"),
                "ENOENT expected for missing fd",
            );
        }
    });

    it("kill syscall terminates a process", async () => {
        const killKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const killPid = await kernelTest!.syscall_spawn(killKernel, "dummy");
        const killPcb = kernelTest!
            .getState(killKernel)
            .processes.get(killPid)!;
        const killRes = kernelTest!.syscall_kill(killKernel, killPid, 9);
        assert.strictEqual(killRes, 0, "kill should return 0");
        assert.strictEqual(
            killPcb.exited,
            true,
            "process should be marked exited",
        );
    });

    it("init process cannot be killed", async () => {
        const initKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const initPid = await kernelTest!.syscall_spawn(initKernel, "dummy");
        kernelTest!.setInitPid(initKernel, initPid);
        const initRes = kernelTest!.syscall_kill(initKernel, initPid, 9);
        assert.strictEqual(initRes, -1, "killing init should fail");
        const initPcb = kernelTest!
            .getState(initKernel)
            .processes.get(initPid)!;
        assert.strictEqual(initPcb.exited, false, "init should remain running");
    });

    it("SIGTERM to init rejected unless in single-user mode", async () => {
        const k = kernelTest!.createKernel(new InMemoryFileSystem());
        const pid = await kernelTest!.syscall_spawn(k, "dummy");
        kernelTest!.setInitPid(k, pid);
        let r = kernelTest!.syscall_kill(k, pid, 15);
        assert.strictEqual(r, -1, "should fail when not single-user");
        kernelTest!.syscall_single_user(k, true);
        r = kernelTest!.syscall_kill(k, pid, 15);
        assert.strictEqual(r, 0, "should succeed in single-user mode");
        const pcb = kernelTest!.getState(k).processes.get(pid)!;
        assert.strictEqual(pcb.exited, true, "init should exit on SIGTERM");
    });

    it("memory quota enforcement", async () => {
        globalThis.window = {} as any;
        globalThis.window.crypto = {
            getRandomValues: (arr: Uint32Array) =>
                require("crypto").randomFillSync(arr),
        };
        const { mockIPC: mockQuota, clearMocks: clearQuota } = await import(
            "@tauri-apps/api/mocks"
        );
        mockQuota(() => ({ running: true, cpu_ms: 1, mem_bytes: 2048 }));
        const quotaKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const quotaPid = await kernelTest!.syscall_spawn(quotaKernel, "dummy", {
            quotaMs: 1,
        });
        const quotaPcb = kernelTest!
            .getState(quotaKernel)
            .processes.get(quotaPid)!;
        kernelTest!.syscall_set_quota(quotaKernel, quotaPcb, undefined, 1024);
        await kernelTest!.runProcess(quotaKernel, quotaPcb);
        clearQuota();
        // @ts-ignore
        delete globalThis.window;
        assert.strictEqual(
            quotaPcb.exited,
            true,
            "process should exit when exceeding memory quota",
        );
    });

    it("cpu quota kills runaway process", async () => {
        globalThis.window = {} as any;
        globalThis.window.crypto = {
            getRandomValues: (arr: Uint32Array) =>
                require("crypto").randomFillSync(arr),
        };
        const { mockIPC, clearMocks } = await import("@tauri-apps/api/mocks");
        let calls = 0;
        mockIPC(() => {
            calls++;
            return { running: true, cpu_ms: 3, mem_bytes: 0 };
        });
        const cpuKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const cpuPid = await kernelTest!.syscall_spawn(cpuKernel, "dummy", {
            quotaMs: 1,
        });
        const cpuPcb = kernelTest!
            .getState(cpuKernel)
            .processes.get(cpuPid)!;
        syscall_set_quota.call(cpuKernel, cpuPcb, undefined, undefined, 5);
        await kernelTest!.runProcess(cpuKernel, cpuPcb);
        await kernelTest!.runProcess(cpuKernel, cpuPcb);
        clearMocks();
        // @ts-ignore
        delete globalThis.window;
        assert(calls >= 2);
        assert.strictEqual(
            cpuPcb.exited,
            true,
            "process exits after exceeding cpu quota",
        );
    });

    it("permission checks on readdir", async () => {
        const permKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(permKernel).fs.createDirectory("/secret", 0o700);
        const pid = kernelTest!.createProcess(permKernel);
        const pcb = kernelTest!.getState(permKernel).processes.get(pid)!;
        try {
            await syscall_readdir.call(permKernel, pcb, "/secret");
            assert.fail("should not list directory");
        } catch (e: any) {
            assert(e.message.includes("EACCES"), "EACCES expected");
        }
    });

    it("permission checks on unlink and rename", async () => {
        const permKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(permKernel).fs.createDirectory("/secret", 0o700);
        kernelTest!.getState(permKernel).fs.createFile("/secret/file.txt", "data", 0o600);
        const pid = kernelTest!.createProcess(permKernel);
        const pcb = kernelTest!.getState(permKernel).processes.get(pid)!;
        try {
            await syscall_unlink.call(permKernel, pcb, "/secret/file.txt");
            assert.fail("unlink should fail");
        } catch (e: any) {
            assert(e.message.includes("EACCES"), "EACCES expected");
        }
        try {
            await syscall_rename.call(
                permKernel,
                pcb,
                "/secret/file.txt",
                "/secret/file2.txt",
            );
            assert.fail("rename should fail");
        } catch (e: any) {
            assert(e.message.includes("EACCES"), "EACCES expected");
        }
    });

    it("permission checks on mkdir", async () => {
        const permKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        kernelTest!.getState(permKernel).fs.createDirectory("/secret", 0o700);
        const pid = kernelTest!.createProcess(permKernel);
        const pcb = kernelTest!.getState(permKernel).processes.get(pid)!;
        try {
            await syscall_mkdir.call(permKernel, pcb, "/secret/new", 0o755);
            assert.fail("mkdir should fail");
        } catch (e: any) {
            assert(e.message.includes("EACCES"), "EACCES expected");
        }
    });

    it("window message validation", () => {
        const msgKernel = kernelTest!.createKernel(new InMemoryFileSystem());
        const pcb = kernelTest!.getState(msgKernel).processes.get(1)!;
        const w1 = kernelTest!.syscall_draw(
            msgKernel,
            pcb,
            new TextEncoder().encode("<p>a</p>"),
            { title: "a" },
        );
        const w2 = kernelTest!.syscall_draw(
            msgKernel,
            pcb,
            new TextEncoder().encode("<p>b</p>"),
            { title: "b" },
        );
        const received: any[] = [];
        const handler = (p: any) => received.push(p);
        eventBus.on("desktop.windowPost", handler);

        (msgKernel as any).handleWindowMessage({
            id: w1,
            data: { source: w1, target: w2, payload: { hello: "world" } },
        });
        eventBus.off("desktop.windowPost", handler);

        assert.strictEqual(received.length, 1, "valid message delivered");
        assert.strictEqual(received[0].id, w2);

        const bad: any[] = [];
        const handlerBad = (p: any) => bad.push(p);
        eventBus.on("desktop.windowPost", handlerBad);
        (msgKernel as any).handleWindowMessage({
            id: w1,
            data: { source: w2, target: w2, payload: {} },
        });
        eventBus.off("desktop.windowPost", handlerBad);
        assert.strictEqual(bad.length, 0, "spoofed source ignored");

        const large: any[] = [];
        const handlerLarge = (p: any) => large.push(p);
        eventBus.on("desktop.windowPost", handlerLarge);
        (msgKernel as any).handleWindowMessage({
            id: w1,
            data: { source: w1, target: w2, payload: { text: "x".repeat(1100) } },
        });
        eventBus.off("desktop.windowPost", handlerLarge);
        assert.strictEqual(large.length, 0, "large payload dropped");
    });
});
