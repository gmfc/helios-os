import type { WindowOpts } from "../core/kernel";

export declare function createWindow(html: string, opts: WindowOpts): number;
export declare function postMessage(winId: number, data: unknown): void;
export declare function onMessage(winId: number, handler: (data: unknown) => void): void;
