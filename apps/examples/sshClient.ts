import { Kernel } from '../../core/kernel';
import { startSshd } from '../../core/services/ssh';

export async function runSshExample(kernel: Kernel) {
  startSshd(kernel, { port: 2222 });
  // Connect to the local SSH service
  const sock = (kernel as any).tcp.connect('127.0.0.1', 2222);
  (kernel as any).tcp.send(sock, new TextEncoder().encode('\n'));
}
