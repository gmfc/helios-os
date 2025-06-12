import { Kernel, ServiceHandler } from "../kernel";

export interface PingOptions {
    port?: number;
}

export function startPingService(kernel: Kernel, opts: PingOptions = {}): void {
    const port = opts.port ?? 0;
    const handler: ServiceHandler = async (data) => data;
    kernel.registerService(`pingd:${port}`, port, "udp", handler);
}

