import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT = 1;
    const STDERR = 2;
    const enc = (s: string) => new TextEncoder().encode(s);

    async function readFile(path: string): Promise<string> {
        const fd = await syscall("open", path, "r");
        let out = "";
        while (true) {
            const chunk = await syscall("read", fd, 1024);
            if (chunk.length === 0) break;
            out += new TextDecoder().decode(chunk);
        }
        await syscall("close", fd);
        return out;
    }

    const action = argv[0];
    if (!action || action === "list") {
        try {
            const list: Array<[string, { port: number; proto: string }]> = await syscall("list_services");
            let out = "";
            for (const [name, info] of list) {
                out += `${name} ${info.proto} ${info.port}\n`;
            }
            await syscall("write", STDOUT, enc(out));
            return 0;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            await syscall("write", STDERR, enc(`service: ${msg}\n`));
            return 1;
        }
    }

    if (action === "stop") {
        const name = argv[1];
        if (!name) {
            await syscall("write", STDERR, enc("service stop: missing name\n"));
            return 1;
        }
        try {
            await syscall("stop_service", name);
            await syscall("write", STDOUT, enc(`stopped ${name}\n`));
            return 0;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            await syscall("write", STDERR, enc(`service: ${msg}\n`));
            return 1;
        }
    }

    if (action === "start") {
        const name = argv[1];
        if (!name) {
            await syscall("write", STDERR, enc("service start: missing name\n"));
            return 1;
        }
        try {
            const code = await readFile(`/bin/${name}`);
            let manifest: { syscalls?: string[] } | undefined;
            try {
                manifest = JSON.parse(await readFile(`/bin/${name}.manifest.json`)) as { syscalls?: string[] };
            } catch {}
            await syscall("spawn", code, { argv: argv.slice(2), syscalls: manifest ? manifest.syscalls : undefined });
            await syscall("write", STDOUT, enc(`started ${name}\n`));
            return 0;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            await syscall("write", STDERR, enc(`service: ${msg}\n`));
            return 1;
        }
    }

    await syscall("write", STDERR, enc("usage: service [list|start|stop] ...\n"));
    return 1;
}


