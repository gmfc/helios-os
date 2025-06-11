import type { SyscallDispatcher } from "../../types/syscalls";

const HIST_PATH = '/bash_history';


export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);
    const decode = (b: Uint8Array) => new TextDecoder().decode(b);

    let history: string[] = [];

    async function loadHistory() {
        try {
            const fd = await syscall('open', HIST_PATH, 'r');
            let data = '';
            while (true) {
                const chunk = await syscall('read', fd, 1024);
                if (chunk.length === 0) break;
                data += decode(chunk);
            }
            await syscall('close', fd);
            history = data.split('\n').filter(l => l);
        } catch {}
    }

    async function appendHistory(cmd: string) {
        try {
            const fd = await syscall('open', HIST_PATH, 'a');
            await syscall('write', fd, encode(cmd + '\n'));
            await syscall('close', fd);
        } catch {}
    }

    async function readFile(path: string): Promise<string> {
        const fd = await syscall('open', path, 'r');
        let out = '';
        while (true) {
            const chunk = await syscall('read', fd, 1024);
            if (chunk.length === 0) break;
            out += decode(chunk);
        }
        await syscall('close', fd);
        return out;
    }

    async function complete(prefix: string): Promise<string[]> {
        try {
            const ents: Array<{ path: string }> = await syscall('readdir', '/bin');
            return ents
                .map(e => e.path.split('/').pop() as string)
                .filter(n => n.startsWith(prefix));
        } catch {
            return [];
        }
    }

    async function readLine(fd: number): Promise<string> {
        let line = '';
        let histIndex = history.length;
        const redraw = async () => {
            await syscall('write', STDOUT_FD, encode('\r\x1b[K$ ' + line));
        };
        while (true) {
            const chunk = await syscall('read', fd, 1);
            if (chunk.length === 0) continue;
            const ch = decode(chunk);
            if (ch === '\n') {
                await syscall('write', STDOUT_FD, encode('\n'));
                break;
            }
            if (ch === '\u007f') {
                if (line.length > 0) {
                    line = line.slice(0, -1);
                    await redraw();
                }
                continue;
            }
            if (ch === '\t') {
                const words = line.split(/\s+/);
                const prefix = words[words.length - 1];
                const matches = await complete(prefix);
                if (matches.length === 1) {
                    words[words.length - 1] = matches[0];
                    line = words.join(' ');
                    await redraw();
                } else if (matches.length > 1) {
                    await syscall('write', STDOUT_FD, encode('\n' + matches.join(' ') + '\n'));
                    await redraw();
                }
                continue;
            }
            if (ch === '\x1b') {
                const seq = decode(await syscall('read', fd, 2));
                if (seq === '[A') {
                    if (histIndex > 0) histIndex--;
                    line = history[histIndex] ?? '';
                    await redraw();
                } else if (seq === '[B') {
                    if (histIndex < history.length) histIndex++;
                    line = histIndex < history.length ? history[histIndex] : '';
                    await redraw();
                }
                continue;
            }
            line += ch;
        }
        return line;
    }

    async function waitPid(pid: number): Promise<void> {
        while (true) {
            const list: Array<{ pid: number; exited?: boolean }> = await syscall('ps');
            const proc = list.find(p => p.pid === pid);
            if (!proc || proc.exited) break;
            await new Promise(r => setTimeout(r, 50));
        }
    }

    const ttyName = argv[0] || 'tty0';
    let tty: number;
    try {
        tty = await syscall('open', '/dev/' + ttyName, 'r');
    } catch {
        await syscall('write', STDERR_FD, encode('bash: unable to open tty\n'));
        return 1;
    }
    await loadHistory();

    const initLimits = await syscall('set_quota');
    let quotaMs = initLimits.quotaMs;
    let quotaMem = initLimits.quotaMem;

    let nextJob = 1;
    const jobs: Array<{ id: number; pids: number[]; command: string; state?: string }> = [];

    while (true) {
        await syscall('write', STDOUT_FD, encode('$ '));
        const line = (await readLine(tty)).trim();
        if (!line) continue;
        history.push(line);
        await appendHistory(line);
        if (line === 'exit') break;

        if (line === 'jobs') {
            let list: Array<{ id: number; pids: number[]; command: string; status?: string }>;
            try {
                list = await syscall('jobs');
            } catch {
                list = jobs;
            }
            for (const j of list) {
                await syscall('write', STDOUT_FD,
                    encode('[' + j.id + '] ' + (j.status || j.state) + ' ' + j.command + '\n'));
            }
            continue;
        }

        if (line.startsWith('fg ')) {
            const id = parseInt(line.slice(3).trim(), 10);
            const job = jobs.find(j => j.id === id);
            if (job) {
                for (const pid of job.pids) {
                    await waitPid(pid);
                }
                job.state = 'Done';
            }
            continue;
        }

        if (line.startsWith('bg ')) {
            const id = parseInt(line.slice(3).trim(), 10);
            const job = jobs.find(j => j.id === id);
            if (job) job.state = 'Running';
            continue;
        }

        if (line.startsWith('ulimit')) {
            const parts = line.split(/\s+/).slice(1);
            if (parts.length === 0) {
                await syscall('write', STDOUT_FD, encode('cpu ' + quotaMs + ' mem ' + quotaMem + '\n'));
            } else {
                for (let i = 0; i < parts.length; i++) {
                    if (parts[i] === '-t' && parts[i + 1]) {
                        quotaMs = parseInt(parts[i + 1], 10);
                        i++;
                    } else if (parts[i] === '-m' && parts[i + 1]) {
                        quotaMem = parseInt(parts[i + 1], 10);
                        i++;
                    }
                }
                await syscall('set_quota', quotaMs, quotaMem);
            }
            continue;
        }

        if (line.startsWith('kill')) {
            const args = line.slice(4).trim().split(/\s+/).filter(a => a);
            for (const arg of args) {
                if (arg.startsWith('%')) {
                    const id = parseInt(arg.slice(1), 10);
                    let list: Array<{ id: number; pids: number[]; command: string; status?: string }>;
                    try {
                        list = await syscall('jobs');
                    } catch {
                        list = jobs;
                    }
                    const job = list.find(j => j.id === id);
                    if (job) {
                        for (const pid of job.pids) {
                            await syscall('kill', pid);
                        }
                    }
                } else {
                    const pid = parseInt(arg, 10);
                    if (!isNaN(pid)) {
                        await syscall('kill', pid);
                    }
                }
            }
            continue;
        }

        const bg = line.endsWith('&');
        const cmd = bg ? line.slice(0, -1).trim() : line;
        const [name, ...args] = cmd.split(' ');
        try {
            const code = await readFile('/bin/' + name);
            let m: { syscalls?: string[] } | undefined;
            try {
                m = JSON.parse(await readFile('/bin/' + name + '.manifest.json')) as { syscalls?: string[] };
            } catch {}
            const pid = await syscall('spawn', code, { argv: args, syscalls: m ? m.syscalls : undefined, tty: ttyName, quotaMs, quotaMem });
            const job = { id: nextJob++, pids: [pid], command: cmd, state: 'Running' };
            jobs.push(job);
            if (!bg) {
                await waitPid(pid);
                job.state = 'Done';
            }
        } catch {
            await syscall('write', STDERR_FD, encode('bash: ' + name + ': command not found\n'));
        }
    }

    await syscall('close', tty);
    return 0;
}
