export const SLEEP_SOURCE = `
  async (_syscall, argv) => {
    const ms = parseInt(argv[0] || '1', 10) * 1000;
    await new Promise(r => setTimeout(r, ms));
    return 0;
  }
`;
