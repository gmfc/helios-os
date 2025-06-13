import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher): Promise<number> {
    const STDOUT_FD = 1;
    const encode = (s: string) => new TextEncoder().encode(s);
    const procs: Array<{ pid: number; cpuPct: number; memPct: number; tty?: string; argv?: string[] }> = await syscall('ps');

    let lines = 'PID %CPU %MEM TTY COMMAND\n';
    for (const p of procs) {
        const cpu = p.cpuPct.toFixed(1);
        const mem = p.memPct.toFixed(1);
        const tty = p.tty ? p.tty : '?';
        const cmd = p.argv ? p.argv.join(' ') : '';
        lines += `${p.pid} ${cpu} ${mem} ${tty} ${cmd}\n`;
    }

    await syscall('write', STDOUT_FD, encode(lines));
    return 0;
}

