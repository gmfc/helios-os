import { NIC, Frame } from './nic';

export interface Route {
  net: number;
  mask: number;
  nic: NIC;
}

function ipToInt(ip: string): number {
  return ip
    .split('.')
    .map(o => parseInt(o, 10))
    .reduce((acc, octet) => (acc << 8) | (octet & 0xff), 0);
}

export class Router {
  private routes: Route[] = [];

  addRoute(network: string, nic: NIC) {
    const [ipStr, maskStr] = network.split('/');
    const maskBits = parseInt(maskStr, 10);
    const mask = maskBits === 0 ? 0 : 0xffffffff << (32 - maskBits);
    const net = ipToInt(ipStr) & mask;
    this.routes.push({ net, mask, nic });
  }

  forward(frame: Frame) {
    const dst = ipToInt(frame.dst);
    for (const r of this.routes) {
      if ((dst & r.mask) === r.net) {
        r.nic.rx.push(frame);
        return;
      }
    }
  }
}
