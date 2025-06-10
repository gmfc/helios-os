export const ULIMIT_SOURCE = `
  async (syscall, argv) => {
    const STDOUT_FD = 1;
    const encode = (s) => new TextEncoder().encode(s);

    if (argv.length === 0) {
      const res = await syscall('set_quota');
      await syscall('write', STDOUT_FD, encode('cpu ' + res.quotaMs + ' mem ' + res.quotaMem + '\n'));
      return 0;
    }

    let ms;
    let mem;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '-t') {
        ms = parseInt(argv[i + 1] || '0', 10);
        i++;
      } else if (argv[i] === '-m') {
        mem = parseInt(argv[i + 1] || '0', 10);
        i++;
      }
    }
    await syscall('set_quota', ms, mem);
    return 0;
  }
`;
