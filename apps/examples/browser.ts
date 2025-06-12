import { Kernel } from "../../core/kernel";
import { startHttpd } from "../../core/services/http";

export async function runBrowserExample(kernel: Kernel) {
    startHttpd(kernel, { port: 8080 });
    // Connect to the local HTTP service and issue a simple request
    const conn = (kernel as any).tcp.connect("127.0.0.1", 8080);
    conn.write(new TextEncoder().encode("GET / HTTP/1.1\r\n\r\n"));
}
