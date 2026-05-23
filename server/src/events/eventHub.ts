import { log } from "../utils/logger";

export interface RealtimeEvent {
  type: string;
  ts: string;
  payload: Record<string, unknown>;
}

export type EventListener = (event: RealtimeEvent) => void;

export class EventHub {
  private readonly listeners = new Map<number, EventListener>();

  private nextListenerId = 1;

  public subscribe(listener: EventListener): () => void {
    const id = this.nextListenerId;
    this.nextListenerId += 1;

    this.listeners.set(id, listener);

    return () => {
      this.listeners.delete(id);
    };
  }

  public publish(type: string, payload: Record<string, unknown>): void {
    if (this.listeners.size === 0) {
      return;
    }

    const event: RealtimeEvent = {
      type,
      ts: new Date().toISOString(),
      payload,
    };

    const failedListenerIds: number[] = [];

    for (const [id, listener] of this.listeners.entries()) {
      try {
        listener(event);
      } catch (error) {
        failedListenerIds.push(id);
        log("warn", "Realtime listener failed", {
          event_type: type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const id of failedListenerIds) {
      this.listeners.delete(id);
    }
  }

  public listenerCount(): number {
    return this.listeners.size;
  }
}
