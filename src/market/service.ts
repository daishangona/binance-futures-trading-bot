import type { EventBus } from '../core/events.js';
import type { ExchangeAdapter } from '../exchanges/types.js';
import type { StateStore } from '../state/store.js';

/** Subscribes to exchange WebSockets and mirrors data into the state store. */
export class MarketDataService {
  constructor(
    private readonly adapter: ExchangeAdapter,
    private readonly store: StateStore,
    private readonly events: EventBus,
  ) {
    this.events.on('ticker', (t) => this.store.setTicker(t));
    this.events.on('orderbook', (b) => this.store.setOrderBook(b));
    this.events.on('fill', (f) => this.store.addFill(f));
  }

  async start(symbols: string[]): Promise<void> {
    await this.adapter.connectMarketData(symbols);
    await this.adapter.connectPrivateStreams();
    await this.refreshAccountState(symbols);
  }

  async refreshAccountState(symbols: string[]): Promise<void> {
    const [balances, positions] = await Promise.all([
      this.adapter.getBalances(),
      this.adapter.getPositions(symbols),
    ]);
    this.store.setBalances(balances);
    for (const p of positions) {
      this.store.setPosition(p);
    }
  }

  async stop(): Promise<void> {
    await this.adapter.disconnect();
  }
}
