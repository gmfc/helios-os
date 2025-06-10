export const MV_SOURCE = `
  async (syscall, argv) => {
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    if (argv.length < 2) {
      await syscall('write', STDERR_FD, encode('mv: missing operand\n'));
      return 1;
    }
    try {
      await syscall('rename', argv[0], argv[1]);
    } catch (e) {
      await syscall('write', STDERR_FD, encode('mv: ' + e.message + '\n'));
      return 1;
    }
    return 0;
  }
`;
