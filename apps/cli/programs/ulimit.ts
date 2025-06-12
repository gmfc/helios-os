import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const encode = (s: string) => new TextEncoder().encode(s);

    const result = 0;

    if (argv.length === 0) {
        const res = await syscall('set_quota');
        await syscall(
            'write',
            STDOUT_FD,
            encode('cpu ' + res.quotaMs + ' total ' + res.quotaMs_total + ' mem ' + res.quotaMem + '\n'),
        );
    } else {
        let ms: number | undefined;
        let mem: number | undefined;
        let total: number | undefined;
        for (let i = 0; i < argv.length; i++) {
            if (argv[i] === '-t') {
                ms = parseInt(argv[i + 1] || '0', 10);
                i++;
            } else if (argv[i] === '-m') {
                mem = parseInt(argv[i + 1] || '0', 10);
                i++;
            } else if (argv[i] === '-T') {
                total = parseInt(argv[i + 1] || '0', 10);
                i++;
            }
        }
        await syscall('set_quota', ms, mem, total);
    }
    return result;
}
