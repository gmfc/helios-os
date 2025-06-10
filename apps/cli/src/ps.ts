export const PS_SOURCE = `
  async (syscall, argv) => {
    const STDOUT_FD = 1;
    const encode = (s) => new TextEncoder().encode(s);
    const procs = await syscall('ps');

    const totalCpu = procs.reduce((n, p) => n + (p.cpuMs || 0), 0);
    const totalMem = procs.reduce((n, p) => n + (p.memBytes || 0), 0);

    let lines = 'PID %CPU %MEM TTY COMMAND\n';
    for (const p of procs) {
      const cpu = totalCpu ? ((p.cpuMs || 0) / totalCpu * 100).toFixed(1) : '0.0';
      const mem = totalMem ? ((p.memBytes || 0) / totalMem * 100).toFixed(1) : '0.0';
      const tty = p.tty ? p.tty : '?';
      const cmd = p.argv ? p.argv.join(' ') : '';
      lines += p.pid + ' ' + cpu + ' ' + mem + ' ' + tty + ' ' + cmd + '\n';
    }

    await syscall('write', STDOUT_FD, encode(lines));
    return 0;
  }
`;
