export const BROWSER_SOURCE = `
  async (syscall, argv) => {
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    if (argv.length === 0) {
      await syscall('write', STDERR_FD, encode('browser: missing url\n'));
      return 1;
    }
    const url = argv[0];
    const html = '<h1>Requested URL: ' + url + '</h1>';
    await syscall('draw', new TextEncoder().encode(html), { title: 'browser' });
    return 0;
  }
`;
