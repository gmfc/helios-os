export const REBOOT_SOURCE = `
  async (syscall) => {
    await syscall('reboot');
    return 0;
  }
`;
