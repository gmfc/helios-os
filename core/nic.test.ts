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
});
