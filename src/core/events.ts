import type {
  AccountBalance,
  Fill,
  OrderBook,
  Position,
  StrategySignal,
  Ticker,
} from './types.js';

export type EventMap = {
  ticker: Ticker;
  orderbook: OrderBook;
  position: Position;
  fill: Fill;
  signal: StrategySignal;
  balance: AccountBalance;
  error: { source: string; message: string; timestamp: number };
  kill_switch: { reason: string; timestamp: number };
};

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<Handler<unknown>>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as Handler<unknown>);
    return () => this.handlers.get(event)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`Event handler error [${event}]:`, err);
      }
    }
  }
}
