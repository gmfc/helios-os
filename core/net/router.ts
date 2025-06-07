import { NIC, Frame } from './nic';

export interface Route {
  network: string; // e.g., '127.0.0.0/8'
  nic: NIC;
}

export class Router {
  private routes: Route[] = [];

  addRoute(network: string, nic: NIC) {
    this.routes.push({ network, nic });
  }

  forward(frame: Frame) {
    for (const r of this.routes) {
      if (frame.dst.startsWith(r.network.split('/')[0])) {
        r.nic.rx.push(frame);
        return;
      }
    }
  }
}
