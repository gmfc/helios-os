import type { WindowOpts } from "./kernel";

export interface DrawPayload {
    id: number;
    html: string;
    opts: WindowOpts;
}

export interface EventMap {
    draw: DrawPayload;
    "desktop.createWindow": DrawPayload;
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
