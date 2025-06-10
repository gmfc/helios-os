import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const pids: number[] = [];
    for (const arg of argv) {
        if (arg.startsWith('%')) {
            const id = parseInt(arg.slice(1), 10);
            try {
                const list: Array<{ id: number; pids: number[] }> = await syscall('jobs');
                const job = list.find(j => j.id === id);
                if (job) pids.push(...job.pids);
            } catch {}
        } else {
            const pid = parseInt(arg, 10);
            if (!isNaN(pid)) pids.push(pid);
        }
    }
    for (const pid of pids) {
        try { await syscall('kill', pid); } catch {}
    }
    return 0;
}
