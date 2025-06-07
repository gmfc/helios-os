import { Kernel, ServiceHandler } from '../kernel';

export interface HttpOptions {
  port?: number;
}

export function startHttpd(kernel: Kernel, opts: HttpOptions = {}): void {
  const port = opts.port ?? 80;
  const handler: ServiceHandler = async data => {
    const req = new TextDecoder().decode(data);
    const response = `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nHello from Helios HTTP on port ${port}\n`;
    return new TextEncoder().encode(response);
  };
  kernel.registerService(`httpd:${port}`, port, 'tcp', handler);
}
