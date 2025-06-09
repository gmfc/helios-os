/**
 * This file contains the source code for the initial binary programs
 * that will be loaded into the virtual file system.
 */

export const CAT_SOURCE = `
  async (syscall, argv) => {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (str) => new TextEncoder().encode(str);

    if (argv.length === 0) {
      await syscall('write', STDERR_FD, encode('cat: missing operand\\n'));
      return 1;
    }
    const path = argv[0];
    const READ_CHUNK_SIZE = 1024;
    let fd = -1;

    try {
      fd = await syscall('open', path, 'r');
      while (true) {
        const data = await syscall('read', fd, READ_CHUNK_SIZE);
        if (data.length === 0) {
          break; // EOF
        }
        await syscall('write', STDOUT_FD, data);
      }
    } catch (e) {
      await syscall('write', STDERR_FD, encode('cat: ' + path + ': ' + e.message + '\\n'));
      return 1;
    } finally {
      if (fd >= 0) {
        await syscall('close', fd);
      }
    }
    return 0;
  }
`;

export const ECHO_SOURCE = `
  async (syscall, argv) => {
    const STDOUT_FD = 1;
    const STDERR_FD = 2;
    const encode = (str) => new TextEncoder().encode(str);
    
    let outputFd = STDOUT_FD;
    let path = null;
    let message = '';
    const redirectionIndex = argv.indexOf('>');
    
    if (redirectionIndex > -1) {
      path = argv[redirectionIndex + 1];
      if (!path) {
        await syscall('write', STDERR_FD, encode('echo: missing redirection file\\n'));
        return 1;
      }
      message = argv.slice(0, redirectionIndex).join(' ') + '\\n';
    } else {
      message = argv.join(' ') + '\\n';
    }

    const bytes = encode(message);

    try {
      if (path) {
        outputFd = await syscall('open', path, 'w');
      }
      if (bytes.length > 0) {
        await syscall('write', outputFd, bytes);
      }
    } catch (e) {
      await syscall('write', STDERR_FD, encode('echo: ' + e.message + '\\n'));
      return 1;
    } finally {
      if (outputFd !== STDOUT_FD) {
        await syscall('close', outputFd);
      }
    }
    return 0;
  }
`; 
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

export const RM_SOURCE = `
  async (syscall, argv) => {
    const STDERR_FD = 2;
    const encode = (s) => new TextEncoder().encode(s);
    if (argv.length === 0) {
      await syscall('write', STDERR_FD, encode('rm: missing operand\n'));
      return 1;
    }
    try {
      await syscall('unlink', argv[0]);
    } catch (e) {
      await syscall('write', STDERR_FD, encode('rm: ' + e.message + '\n'));
      return 1;
    }
    return 0;
  }
`;

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

export const PS_SOURCE = `
  async (syscall, argv) => {
    const STDOUT_FD = 1;
    const procs = await syscall('ps');
    const lines = procs.map(p => p.pid + ' ' + (p.argv ? p.argv.join(' ') : '')).join('\n') + '\n';
    await syscall('write', STDOUT_FD, new TextEncoder().encode(lines));
    return 0;
  }
`;


export const CAT_MANIFEST = JSON.stringify({
  name: 'cat',
  syscalls: ['open', 'read', 'write', 'close']
});

export const ECHO_MANIFEST = JSON.stringify({
  name: 'echo',
  syscalls: ['open', 'write', 'close']
});

export const NANO_MANIFEST = JSON.stringify({
  name: 'nano',
  syscalls: ['open', 'read', 'write', 'close', 'draw']
});

export const BROWSER_MANIFEST = JSON.stringify({
  name: 'browser',
  syscalls: ['draw']
});

export const PING_MANIFEST = JSON.stringify({
  name: 'ping',
  syscalls: ['connect', 'tcp_send', 'write']
});

export const DESKTOP_MANIFEST = JSON.stringify({
  name: 'desktop',
  syscalls: ['open', 'read', 'write', 'close', 'spawn']
});

export const LS_MANIFEST = JSON.stringify({
  name: 'ls',
  syscalls: ['readdir', 'write']
});

export const MKDIR_MANIFEST = JSON.stringify({
  name: 'mkdir',
  syscalls: ['mkdir', 'write']
});

export const RM_MANIFEST = JSON.stringify({
  name: 'rm',
  syscalls: ['unlink', 'write']
});

export const MV_MANIFEST = JSON.stringify({
  name: 'mv',
  syscalls: ['rename', 'write']
});

export const PS_MANIFEST = JSON.stringify({
  name: 'ps',
  syscalls: ['ps', 'write']
});

export const LOGIN_SOURCE = `
  async (syscall, argv) => {
    const STDOUT_FD = 1;
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

    async function readLine(fd) {
      let line = '';
      while (true) {
        const chunk = await syscall('read', fd, 1);
        if (chunk.length === 0) break;
        const ch = decode(chunk);
        if (ch === '\n') break;
        line += ch;
      }
      return line;
    }

    let tty;
    try {
      tty = await syscall('open', '/dev/tty0', 'r');
    } catch {
      await syscall('write', STDERR_FD, encode('login: /dev/tty0 not found\n'));
      return 1;
    }

    await syscall('write', STDOUT_FD, encode('login: '));
    await readLine(tty);
    await syscall('write', STDOUT_FD, encode('password: '));
    await readLine(tty);
    await syscall('close', tty);

    try {
      const code = await readFile('/bin/bash');
      let m;
      try { m = JSON.parse(await readFile('/bin/bash.manifest.json')); } catch {}
      await syscall('spawn', code, { syscalls: m ? m.syscalls : undefined });
    } catch {
      await syscall('write', STDERR_FD, encode('login: failed to launch shell\n'));
      return 1;
    }
    return 0;
  }
`;

export const LOGIN_MANIFEST = JSON.stringify({
  name: 'login',
  syscalls: ['open', 'read', 'write', 'close', 'spawn']
});

export const INIT_SOURCE = `
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

    try {
      const code = await readFile('/bin/login');
      let m;
      try { m = JSON.parse(await readFile('/bin/login.manifest.json')); } catch {}
      await syscall('spawn', code, { syscalls: m ? m.syscalls : undefined });
    } catch {
      await syscall('write', STDERR_FD, encode('init: failed to launch login\n'));
      return 1;
    }
    return 0;
  }
`;

export const INIT_MANIFEST = JSON.stringify({
  name: 'init',
  syscalls: ['open', 'read', 'write', 'close', 'spawn']
});

