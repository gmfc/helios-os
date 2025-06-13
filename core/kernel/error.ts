export class KernelError extends Error {
    public errno: number;

    constructor(errno: number, message: string) {
        super(message);
        this.errno = errno;
        this.name = 'KernelError';
    }
}

