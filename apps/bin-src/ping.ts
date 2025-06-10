export const PING_SOURCE = `
  async (syscall, argv) => {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    const ip = argv[0] || '127.0.0.1';
    const port = argv[1] ? parseInt(argv[1], 10) : 7;
    try {
      const sock = await syscall('connect', ip, port);
      const start = Date.now();
      const resp = await syscall('tcp_send', sock, encode('ping'));
      const end = Date.now();
      if (resp) {
        await syscall('write', STDOUT_FD, encode('pong ' + (end - start) + 'ms\n'));
      } else {
        await syscall('write', STDERR_FD, encode('no response\n'));
      }
    } catch (e) {
      await syscall('write', STDERR_FD, encode('ping: ' + e.message + '\n'));
      return 1;
    }
    return 0;
  }
`;
