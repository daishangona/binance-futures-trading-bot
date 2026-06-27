import type {
  AccountBalance,
  BotConfig,
  ExchangeCredentials,
  ExchangeId,
  Fill,
  NormalizedOrder,
  OrderBook,
  PlaceOrderRequest,
  Position,
  Ticker,
} from '../core/types.js';

export interface ExchangeAdapter {
  readonly id: ExchangeId;

  connectMarketData(symbols: string[]): Promise<void>;
  connectPrivateStreams(): Promise<void>;
  disconnect(): Promise<void>;

  getTicker(symbol: string): Promise<Ticker>;
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
  getPositions(symbols?: string[]): Promise<Position[]>;
  getBalances(): Promise<AccountBalance[]>;

  placeOrder(order: PlaceOrderRequest): Promise<NormalizedOrder>;
  cancelOrder(symbol: string, clientOrderId: string): Promise<void>;
  getOrder(symbol: string, clientOrderId: string): Promise<NormalizedOrder>;

  setLeverage(symbol: string, leverage: number): Promise<void>;
  normalizeSymbol(symbol: string): string;
}

export interface ExchangeAdapterFactory {
  create(
    credentials: ExchangeCredentials,
    config: Pick<BotConfig, 'paperTrading' | 'testnet'>,
  ): ExchangeAdapter;
}

export interface RestClientOptions {
  baseUrl: string;
  credentials?: ExchangeCredentials;
  paperTrading?: boolean;
}

export interface WsMessageHandler {
  onMessage(data: unknown): void;
  onError(error: Error): void;
  onClose(): void;
}
