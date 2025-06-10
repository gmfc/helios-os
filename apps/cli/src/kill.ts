export const KILL_SOURCE = `
  async (syscall, argv) => {
    const pids = [];
    for (const arg of argv) {
      if (arg.startsWith('%')) {
        const id = parseInt(arg.slice(1), 10);
        try {
          const list = await syscall('jobs');
          const job = list.find(j => j.id === id);
          if (job) pids.push(...job.pids);
        } catch {}
      } else {
        const pid = parseInt(arg, 10);
        if (!isNaN(pid)) pids.push(pid);
      }
    }
    for (const pid of pids) {
      try { await syscall('kill', pid); } catch {}
    }
    return 0;
  }
`;
