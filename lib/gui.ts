import { eventBus } from "../core/utils/eventBus";
import type { WindowOpts } from "../core/kernel";

export async function createWindow(html: string, opts: WindowOpts): Promise<number> {
    const syscall = (globalThis as any).syscall as ((call: string, ...args: any[]) => Promise<any>);
    if (typeof syscall !== "function") {
        throw new Error("syscall not available");
    }
    const data = new TextEncoder().encode(html);
    return syscall("draw", data, opts) as Promise<number>;
}

export function postMessage(source: number, target: number, data: unknown): void {
    eventBus.emit("desktop.windowPost", {
        id: target,
        data: { source, target, payload: data },
    });
}

export function onMessage(winId: number, handler: (data: unknown) => void): void {
    const cb = (payload: { id: number; data: unknown }) => {
        if (payload.id === winId) handler(payload.data);
    };
    eventBus.on("desktop.windowRecv", cb);
}
