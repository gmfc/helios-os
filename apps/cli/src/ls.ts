export const LS_SOURCE = `
  async (syscall, argv) => {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    const path = argv[0] || '/';
    try {
      const entries = await syscall('readdir', path);
      const names = entries.map(e => e.path.split('/').pop()).join('\n') + '\n';
      await syscall('write', STDOUT_FD, encode(names));
    } catch (e) {
      await syscall('write', STDERR_FD, encode('ls: ' + e.message + '\n'));
      return 1;
    }
    return 0;
  }
`;
