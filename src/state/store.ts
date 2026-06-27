import type {
  AccountBalance,
  Fill,
  NormalizedOrder,
  OrderBook,
  Position,
  StrategySignal,
  Ticker,
} from '../core/types.js';

export interface DailyStats {
  date: string;
  realizedPnl: number;
  trades: number;
  apiErrors: number;
}

export interface BotRuntimeState {
  killSwitchActive: boolean;
  killSwitchReason?: string;
  lastSignalBySymbol: Map<string, StrategySignal>;
  lastTradeAtBySymbol: Map<string, number>;
  openOrders: Map<string, NormalizedOrder>;
  positions: Map<string, Position>;
  tickers: Map<string, Ticker>;
  orderBooks: Map<string, OrderBook>;
  balances: AccountBalance[];
  fills: Fill[];
  dailyStats: DailyStats;
  consecutiveApiErrors: number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export class StateStore {
  private state: BotRuntimeState;

  constructor() {
    this.state = this.emptyState();
  }

  private emptyState(): BotRuntimeState {
    return {
      killSwitchActive: false,
      lastSignalBySymbol: new Map(),
      lastTradeAtBySymbol: new Map(),
      openOrders: new Map(),
      positions: new Map(),
      tickers: new Map(),
      orderBooks: new Map(),
      balances: [],
      fills: [],
      dailyStats: { date: todayKey(), realizedPnl: 0, trades: 0, apiErrors: 0 },
      consecutiveApiErrors: 0,
    };
  }

  resetDailyIfNeeded(): void {
    const today = todayKey();
    if (this.state.dailyStats.date !== today) {
      this.state.dailyStats = { date: today, realizedPnl: 0, trades: 0, apiErrors: 0 };
      if (this.state.killSwitchActive && this.state.killSwitchReason?.includes('daily loss')) {
        this.state.killSwitchActive = false;
        this.state.killSwitchReason = undefined;
      }
    }
  }

  getSnapshot(): Readonly<BotRuntimeState> {
    this.resetDailyIfNeeded();
    return this.state;
  }

  setTicker(ticker: Ticker): void {
    this.state.tickers.set(`${ticker.exchange}:${ticker.symbol}`, ticker);
  }

  getTicker(exchange: string, symbol: string): Ticker | undefined {
    return this.state.tickers.get(`${exchange}:${symbol}`);
  }

  setOrderBook(book: OrderBook): void {
    this.state.orderBooks.set(`${book.exchange}:${book.symbol}`, book);
  }

  setPosition(position: Position): void {
    const key = `${position.exchange}:${position.symbol}:${position.side}`;
    if (position.quantity === 0) {
      this.state.positions.delete(key);
    } else {
      this.state.positions.set(key, position);
    }
  }

  getOpenPositions(): Position[] {
    return [...this.state.positions.values()].filter((p) => p.quantity !== 0);
  }

  setBalances(balances: AccountBalance[]): void {
    this.state.balances = balances;
  }

  getEquityUsd(): number {
    const usdt = this.state.balances.find(
      (b) => b.asset === 'USDT' || b.asset === 'USD',
    );
    return usdt?.marginBalance ?? usdt?.walletBalance ?? 0;
  }

  setSignal(signal: StrategySignal): void {
    this.state.lastSignalBySymbol.set(`${signal.exchange}:${signal.symbol}`, signal);
  }

  getLastSignal(exchange: string, symbol: string): StrategySignal | undefined {
    return this.state.lastSignalBySymbol.get(`${exchange}:${symbol}`);
  }

  recordTrade(symbol: string): void {
    this.state.lastTradeAtBySymbol.set(symbol, Date.now());
    this.state.dailyStats.trades += 1;
  }

  getLastTradeAt(symbol: string): number | undefined {
    return this.state.lastTradeAtBySymbol.get(symbol);
  }

  upsertOrder(order: NormalizedOrder): void {
    this.state.openOrders.set(order.clientOrderId, order);
    if (order.status === 'filled' || order.status === 'cancelled' || order.status === 'rejected') {
      this.state.openOrders.delete(order.clientOrderId);
    }
  }

  addFill(fill: Fill): void {
    this.state.fills.push(fill);
    if (this.state.fills.length > 1000) {
      this.state.fills = this.state.fills.slice(-500);
    }
  }

  recordApiError(): void {
    this.state.consecutiveApiErrors += 1;
    this.state.dailyStats.apiErrors += 1;
  }

  clearApiErrors(): void {
    this.state.consecutiveApiErrors = 0;
  }

  activateKillSwitch(reason: string): void {
    this.state.killSwitchActive = true;
    this.state.killSwitchReason = reason;
  }

  isKillSwitchActive(): boolean {
    return this.state.killSwitchActive;
  }

  addRealizedPnl(amount: number): void {
    this.resetDailyIfNeeded();
    this.state.dailyStats.realizedPnl += amount;
  }
}

/** Redis/PostgreSQL persistence hooks — implement for production */
export interface StatePersistence {
  saveTrade(record: unknown): Promise<void>;
  saveSignal(signal: StrategySignal): Promise<void>;
  saveAudit(event: string, payload: unknown): Promise<void>;
}

export class NoOpPersistence implements StatePersistence {
  async saveTrade(): Promise<void> {}
  async saveSignal(): Promise<void> {}
  async saveAudit(): Promise<void> {}
}
