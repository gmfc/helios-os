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

