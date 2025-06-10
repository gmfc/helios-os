import assert from "assert";
import { TCP } from "./tcp";
import { UDP } from "./udp";
import { NIC } from "./nic";
import { Switch } from "./switch";
import { Router } from "./router";

function testTcp() {
    const tcp = new TCP();
    let received: Uint8Array | null = null;
    tcp.listen(8080, (data) => {
        received = data;
    });
    const sock = tcp.connect("127.0.0.1", 8080);
    const payload = new Uint8Array([1, 2, 3]);
    tcp.send(sock, payload);
    assert(
        received &&
            (received as Uint8Array).length === 3 &&
            (received as Uint8Array)[0] === 1,
        "TCP handler should receive data",
    );
    console.log("TCP listen/connect test passed.");
}

function testUdp() {
    const udp = new UDP();
    let from: { ip: string; port: number } | null = null;
    udp.listen(53, (_data, src) => {
        from = src;
    });
    const sock = udp.connect("127.0.0.1", 53);
    udp.send(sock, new Uint8Array([0]));
    assert.deepStrictEqual(from, { ip: "127.0.0.1", port: 53 });
    console.log("UDP handler source info test passed.");
}

function testSwitch() {
    const sw = new Switch();
    const a = new NIC("1", "AA");
    const b = new NIC("2", "BB");
    const c = new NIC("3", "CC");
    sw.connect(a);
    sw.connect(b);
    sw.connect(c);
    // first send from A to B (unknown dst -> broadcast)
    a.send({ src: "AA", dst: "BB", payload: new Uint8Array([1]) });
    sw.tick();
    assert(
        b.rx.length === 1 && c.rx.length === 1,
        "broadcast on unknown destination",
    );
    b.rx.length = 0;
    c.rx.length = 0;
    // now send from B to A (known dst -> unicast)
    b.send({ src: "BB", dst: "AA", payload: new Uint8Array([2]) });
    sw.tick();
    assert(
        a.rx.length === 1 && c.rx.length === 0,
        "unicast on known destination",
    );
    console.log("Switch forwarding test passed.");
}

function testRouter() {
    const router = new Router();
    const nic1 = new NIC("1", "AA");
    const nic2 = new NIC("2", "BB");
    router.addRoute("192.168.1.0/24", nic2);
    const frame = {
        src: "10.0.0.1",
        dst: "192.168.1.5",
        payload: new Uint8Array([3]),
    };
    router.forward(frame);
    assert(
        nic2.rx.length === 1 && nic2.rx[0] === frame,
        "router forwards to correct NIC",
    );
    console.log("Router forward test passed.");
}

async function testTcpEcho() {
    const tcp = new TCP();
    tcp.listen(9000, (data) => data);
    const sock = tcp.connect("127.0.0.1", 9000);
    const payload = new Uint8Array([9, 8, 7]);
    const resp = await tcp.send(sock, payload);
    assert(
        resp && resp.length === 3 && resp[0] === 9,
        "TCP send returns response",
    );
    console.log("TCP send response test passed.");
}

async function run() {
    testTcp();
    testUdp();
    testSwitch();
    testRouter();
    await testTcpEcho();
}

run();
