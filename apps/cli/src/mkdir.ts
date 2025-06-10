export const MKDIR_SOURCE = `
  async (syscall, argv) => {
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    if (argv.length === 0) {
      await syscall('write', STDERR_FD, encode('mkdir: missing operand\n'));
      return 1;
    }
    try {
      await syscall('mkdir', argv[0], 0o755);
    } catch (e) {
      await syscall('write', STDERR_FD, encode('mkdir: ' + e.message + '\n'));
      return 1;
    }
    return 0;
  }
`;
