import type { SyscallDispatcher } from "../../core/kernel/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (str: string) => new TextEncoder().encode(str);

    let outputFd = STDOUT_FD;
    let path: string | null = null;
    let message = "";
    const redirectionIndex = argv.indexOf('>');

    if (redirectionIndex > -1) {
        path = argv[redirectionIndex + 1];
        if (!path) {
            await syscall('write', STDERR_FD, encode('echo: missing redirection file\n'));
            return 1;
        }
        message = argv.slice(0, redirectionIndex).join(' ') + '\n';
    } else {
        message = argv.join(' ') + '\n';
    }

    const bytes = encode(message);

    try {
        if (path) {
            outputFd = await syscall('open', path, 'w');
        }
        if (bytes.length > 0) {
            await syscall('write', outputFd, bytes);
        }
    } catch (e: any) {
        await syscall('write', STDERR_FD, encode('echo: ' + e.message + '\n'));
        return 1;
    } finally {
        if (outputFd !== STDOUT_FD) {
            await syscall('close', outputFd);
        }
    }
    return 0;
}
