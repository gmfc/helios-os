import { Kernel } from '../core/kernel';

export async function runEchoExample(kernel: Kernel) {
  await kernel.spawn('echo hello from syscall');
}
