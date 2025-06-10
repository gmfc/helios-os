import { Kernel, ServiceHandler } from "../kernel";

export interface SshOptions {
    port?: number;
}

export function startSshd(kernel: Kernel, opts: SshOptions = {}): void {
    const port = opts.port ?? 22;
    const greeting = new TextEncoder().encode("Welcome to Helios SSH\n");
    const handler: ServiceHandler = async (data) => {
        const cmd = new TextDecoder().decode(data).trim();
        if (cmd.length === 0) {
            return greeting;
        }
        const resp = new TextEncoder().encode("Unknown command\n");
        return resp;
    };
    kernel.registerService(`sshd:${port}`, port, "tcp", handler);
}
