import assert from "assert";
import { describe, it } from "vitest";
import { InMemoryFileSystem } from "./fs";
import { kernelTest } from "./kernel";

describe("NIC syscalls", () => {
    it("interface state changes", () => {
        const k = kernelTest!.createKernel(new InMemoryFileSystem());
        k.startNetworking();
        kernelTest!.syscall_create_nic(k, "eth0", "AA:BB:CC:DD:EE:FF");
        kernelTest!.syscall_nic_up(k, "eth0");
        let list = kernelTest!.syscall_list_nics(k);
        const eth = list.find((n) => n.id === "eth0");
        assert(eth && eth.status === "up", "interface brought up");

        kernelTest!.syscall_nic_config(k, "eth0", "192.168.0.2", "255.255.255.0");
        list = kernelTest!.syscall_list_nics(k);
        const eth2 = list.find((n) => n.id === "eth0");
        assert(eth2 && eth2.ip === "192.168.0.2", "ip assigned");

        kernelTest!.syscall_nic_down(k, "eth0");
        list = kernelTest!.syscall_list_nics(k);
        const eth3 = list.find((n) => n.id === "eth0");
        assert(eth3 && eth3.status === "down", "interface brought down");

        kernelTest!.syscall_remove_nic(k, "eth0");
        list = kernelTest!.syscall_list_nics(k);
        assert(!list.find((n) => n.id === "eth0"), "interface removed");
    });

    it("dhcp assigns unique ip", () => {
        const k = kernelTest!.createKernel(new InMemoryFileSystem());
        k.startNetworking();
        kernelTest!.syscall_create_nic(k, "eth0", "AA:BB:CC:DD:EE:01");
        kernelTest!.syscall_create_nic(k, "eth1", "AA:BB:CC:DD:EE:02");
        const r1 = kernelTest!.syscall_dhcp_request(k, "eth0");
        const r2 = kernelTest!.syscall_dhcp_request(k, "eth1");
        assert(r1.ip !== r2.ip, "addresses must be unique");
    });

    it("dhcp increments leases", () => {
        const k = kernelTest!.createKernel(new InMemoryFileSystem());
        k.startNetworking();
        kernelTest!.syscall_create_nic(k, "eth0", "AA:BB:CC:DD:EE:10");
        kernelTest!.syscall_create_nic(k, "eth1", "AA:BB:CC:DD:EE:11");
        const r1 = kernelTest!.syscall_dhcp_request(k, "eth0");
        const r2 = kernelTest!.syscall_dhcp_request(k, "eth1");
        assert.strictEqual(r1.ip, "10.0.0.2");
        assert.strictEqual(r2.ip, "10.0.0.3");
    });

    it("wifi scan and join", async () => {
        // @ts-ignore
        globalThis.window = {} as any;
        const { mockIPC, clearMocks } = await import("@tauri-apps/api/mocks");
        mockIPC((cmd, args) => {
            if (cmd === "wifi_scan") {
                return ["helios"];
            }
            if (cmd === "wifi_join") {
                return args.ssid === "helios" && args.passphrase === "password";
            }
            if (cmd === "register_nic") {
                return null;
            }
            return null;
        });

        const k = kernelTest!.createKernel(new InMemoryFileSystem());
        k.startNetworking();
        kernelTest!.syscall_create_nic(k, "wlan0", "AA:BB:CC:DD:EE:03", undefined, undefined, "wifi");
        const ssids = await kernelTest!.syscall_wifi_scan(k);
        assert(ssids.includes("helios"), "scan returns ssid");
        const res = await kernelTest!.syscall_wifi_join(k, "wlan0", "helios", "password");
        assert.strictEqual(res, 0, "join success");
        const nic = kernelTest!.getState(k).nics.get("wlan0")!;
        assert(nic.ip !== undefined, "dhcp assigned");
        clearMocks();
        // @ts-ignore
        delete globalThis.window;
    });
});
