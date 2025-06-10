import type { SyscallDispatcher } from "../../core/kernel/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);

    if (argv.length < 2) {
        await syscall('write', STDERR_FD, encode('usage: snapshot <save|load> <name>\n'));
        return 1;
    }

    const action = argv[0];
    const name = argv[1];

    if (action === 'save') {
        const snap = await syscall('snapshot');
        await syscall('save_snapshot_named', name, snap);
        return 0;
    }

    if (action === 'load') {
        await syscall('load_snapshot_named', name);
        await syscall('reboot');
        return 0;
    }

    await syscall('write', STDERR_FD, encode('snapshot: unknown action\n'));
    return 1;
}
