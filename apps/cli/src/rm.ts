export const RM_SOURCE = `
  async (syscall, argv) => {
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    if (argv.length === 0) {
      await syscall('write', STDERR_FD, encode('rm: missing operand\n'));
      return 1;
    }
    try {
      await syscall('unlink', argv[0]);
    } catch (e) {
      await syscall('write', STDERR_FD, encode('rm: ' + e.message + '\n'));
      return 1;
    }
    return 0;
  }
`;
