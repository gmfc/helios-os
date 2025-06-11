import type { WindowOpts, Monitor } from "./kernel";
import type { SpawnOptions } from "../kernel/syscalls";

export interface DrawPayload {
    id: number;
    html: string;
    opts: WindowOpts;
}

export interface WindowMessagePayload {
    id: number;
    data: unknown;
}

export interface EventMap {
    draw: DrawPayload;
    "desktop.createWindow": DrawPayload;
    "desktop.updateMonitors": Monitor[];
    "desktop.windowPost": WindowMessagePayload;
    "desktop.windowRecv": WindowMessagePayload;
    "desktop.appCrashed": { id: number; code: string; opts: SpawnOptions };
    "boot.shellReady": { pid: number };
    "system.reboot": {};
}

export type Handler<T = unknown> = (payload: T) => void;

class EventBus<Events extends Record<string, unknown>> {
    private handlers: { [K in keyof Events]?: Handler<Events[K]>[] } = {};

    on<K extends keyof Events>(event: K, handler: Handler<Events[K]>) {
        if (!this.handlers[event]) {
            this.handlers[event] = [];
        }
        this.handlers[event]!.push(handler);
    }

    off<K extends keyof Events>(event: K, handler: Handler<Events[K]>) {
        if (!this.handlers[event]) return;
        this.handlers[event] = this.handlers[event]!.filter(
            (h) => h !== handler,
        );
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]) {
        (this.handlers[event] || []).forEach((h) => h(payload));
    }
}

export const eventBus = new EventBus<EventMap>();
