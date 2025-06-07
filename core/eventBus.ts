export type Handler<T = any> = (payload: T) => void;

class EventBus {
  private handlers: Record<string, Handler[]> = {};

  on(event: string, handler: Handler) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);
  }

  off(event: string, handler: Handler) {
    if (!this.handlers[event]) return;
    this.handlers[event] = this.handlers[event].filter(h => h !== handler);
  }

  emit(event: string, payload: any) {
    (this.handlers[event] || []).forEach(h => h(payload));
  }
}

export const eventBus = new EventBus();
