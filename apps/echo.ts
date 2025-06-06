import { Program, SyscallDispatcher } from '../core/kernel';

const echoProgram: Program = {
  async main(syscall: SyscallDispatcher, argv: string[]): Promise<number> {
    const message = argv.join(' ') + '\n';
    const bytes = new TextEncoder().encode(message);
    await syscall('write', 1, bytes); // fd 1 is stdout
    return 0;
  }
};

export default echoProgram; 