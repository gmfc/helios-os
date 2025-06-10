import type { SyscallDispatcher } from "../../core/kernel/syscalls";

export async function main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (str: string) => new TextEncoder().encode(str);

    if (argv.length === 0) {
        await syscall("write", STDERR_FD, encode("cat: missing operand\n"));
        return 1;
    }
    const path = argv[0];
    const READ_CHUNK_SIZE = 1024;
    let fd = -1;
    try {
        fd = await syscall("open", path, "r");
        while (true) {
            const data: Uint8Array = await syscall("read", fd, READ_CHUNK_SIZE);
            if (data.length === 0) {
                break;
            }
            await syscall("write", STDOUT_FD, data);
        }
    } catch (e: any) {
        await syscall("write", STDERR_FD, encode("cat: " + path + ": " + e.message + "\n"));
        return 1;
    } finally {
        if (fd >= 0) {
            await syscall("close", fd);
        }
    }
    return 0;
}
