export const DESKTOP_SOURCE = `
  async (syscall, argv) => {
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    const decode = (b) => new TextDecoder().decode(b);

    async function readFile(path) {
      const fd = await syscall('open', path, 'r');
      let out = '';
      while (true) {
        const chunk = await syscall('read', fd, 1024);
        if (chunk.length === 0) break;
        out += decode(chunk);
      }
      await syscall('close', fd);
      return out;
    }

    const progs = argv.length > 0 ? argv : ['browser'];
    for (const cmd of progs) {
      const [name, ...args] = cmd.split(' ');
      try {
        const code = await readFile('/bin/' + name);
        let m;
        try {
          m = JSON.parse(await readFile('/bin/' + name + '.manifest.json'));
        } catch {}
        await syscall('spawn', code, { argv: args, syscalls: m ? m.syscalls : undefined });
      } catch {
        await syscall('write', STDERR_FD, encode('desktop: failed to launch ' + name + '\n'));
      }
    }
    return 0;
  }
`;
