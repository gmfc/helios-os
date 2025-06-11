import type { SyscallDispatcher } from "../../types/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDERR_FD = 2;
    const encode = (s: string) => new TextEncoder().encode(s);
    const decode = (b: Uint8Array) => new TextDecoder().decode(b);

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

    const progs = ['browser', ...argv];
    for (const cmd of progs) {
        const [name, ...args] = cmd.split(' ');
        try {
            const code = await readFile('/bin/' + name);
            let m: { syscalls?: string[] } | undefined;
            try {
                m = JSON.parse(await readFile('/bin/' + name + '.manifest.json')) as { syscalls?: string[] };
            } catch {}
            await syscall('spawn', code, { argv: args, syscalls: m ? m.syscalls : undefined });
        } catch {
            await syscall('write', STDERR_FD, encode('desktop: failed to launch ' + name + '\n'));
        }
    }

    const wallpaper = `<style>body{margin:0;background:#004 url('/icons/wallpaper.jpg') center/cover no-repeat;}</style>`;
    await syscall('draw', new TextEncoder().encode(wallpaper), {
        title: 'Desktop',
        width: 800,
        height: 600,
        x: 0,
        y: 0,
    });

    const panelHtml = `
        <style>
            body{margin:0;background:#222;color:#fff;font-family:sans-serif;font-size:14px;display:flex;align-items:center;justify-content:flex-end;padding:4px;}
        </style>
        <div id="clock"></div>
        <script>
        function update(){
            const now=new Date();
            document.getElementById('clock').textContent=now.toLocaleTimeString();
        }
        update();
        setInterval(update,1000);
        </script>
    `;
    await syscall('draw', new TextEncoder().encode(panelHtml), {
        title: 'Panel',
        width: 800,
        height: 30,
        x: 0,
        y: 0,
    });
    return 0;
}
