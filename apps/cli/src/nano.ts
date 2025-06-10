export const NANO_SOURCE = `
  async (syscall, argv) => {
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    if (argv.length === 0) {
      await syscall('write', STDERR_FD, encode('nano: missing file\n'));
      return 1;
    }
    const path = argv[0];
    let content = '';
    try {
      const fd = await syscall('open', path, 'r');
      while (true) {
        const chunk = await syscall('read', fd, 1024);
        if (chunk.length === 0) break;
        content += new TextDecoder().decode(chunk);
      }
      await syscall('close', fd);
    } catch (e) {
      // new file - start empty
    }
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const html = '<pre>' + escaped + '</pre>';
    await syscall('draw', new TextEncoder().encode(html), { title: 'nano - ' + path });
    return 0;
  }
`;
