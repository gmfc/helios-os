import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const enc = (s: string) => new TextEncoder().encode(s);

    if (argv.length < 2) {
        await syscall('write', STDOUT_FD, enc('usage: xrandr --add-monitor WxH | --remove-monitor ID\n'));
        return 0;
    }

    try {
        if (argv[0] === '--add-monitor') {
            const [w, h] = argv[1].split('x').map(n => parseInt(n, 10));
            if (!w || !h) throw new Error('bad resolution');
            const id = await syscall('add_monitor', w, h);
            await syscall('write', STDOUT_FD, enc(`monitor ${id} added\n`));
        } else if (argv[0] === '--remove-monitor') {
            const id = parseInt(argv[1], 10);
            if (isNaN(id)) throw new Error('bad id');
            const res = await syscall('remove_monitor', id);
            if (res === 0) {
                await syscall('write', STDOUT_FD, enc(`monitor ${id} removed\n`));
            } else {
                await syscall('write', STDERR_FD, enc('xrandr: failed\n'));
                return 1;
            }
        } else {
            await syscall('write', STDERR_FD, enc('xrandr: unknown option\n'));
            return 1;
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await syscall('write', STDERR_FD, enc('xrandr: ' + msg + '\n'));
        return 1;
    }
    return 0;
}

