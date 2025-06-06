import { Program, SyscallDispatcher } from '../core/kernel';

const catProgram: Program = {
  main: async (syscall: SyscallDispatcher, argv: string[]): Promise<number> => {
    if (argv.length === 0) {
      console.error('cat: missing operand');
      return 1;
    }

    const path = argv[0];
    const STDOUT_FD = 1;
    const READ_CHUNK_SIZE = 1024;

    try {
      const fd = await syscall('open', path, 'r');
      
      while (true) {
        const data = await syscall('read', fd, READ_CHUNK_SIZE);
        if (data.length === 0) {
          // End of file
          break;
        }
        await syscall('write', STDOUT_FD, data);
      }
      
      // Note: A 'close' syscall would be needed in a more complete implementation.
      return 0;
    } catch (error) {
      console.error(`cat: ${path}: ${(error as Error).message}`);
      return 1;
    }
  },
};

export default catProgram; 