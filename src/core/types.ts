export type ExchangeId = 'binance' | 'bybit' | 'okx';

export type Side = 'buy' | 'sell';
export type PositionSide = 'long' | 'short' | 'both';
export type OrderType = 'market' | 'limit' | 'stop_market' | 'take_profit_market';
export type OrderStatus =
  | 'pending'
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'expired';

export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY';

export interface NormalizedSymbol {
  /** Internal canonical symbol, e.g. BTCUSDT */
  canonical: string;
  base: string;
  quote: string;
  exchangeSymbol: string;
}

export interface Ticker {
  exchange: ExchangeId;
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  markPrice?: number;
  indexPrice?: number;
  fundingRate?: number;
  nextFundingTime?: number;
  timestamp: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  exchange: ExchangeId;
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface Position {
  exchange: ExchangeId;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice?: number;
  marginMode?: 'cross' | 'isolated';
  updatedAt: number;
}

export interface NormalizedOrder {
  clientOrderId: string;
  exchangeOrderId?: string;
  exchange: ExchangeId;
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  positionSide?: PositionSide;
  timeInForce?: TimeInForce;
  status: OrderStatus;
  filledQuantity: number;
  avgFillPrice?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Fill {
  exchange: ExchangeId;
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: Side;
  price: number;
  quantity: number;
  fee: number;
  feeAsset: string;
  timestamp: number;
}

export interface AccountBalance {
  exchange: ExchangeId;
  asset: string;
  walletBalance: number;
  availableBalance: number;
  unrealizedPnl: number;
  marginBalance: number;
  updatedAt: number;
}

export type SignalAction = 'enter_long' | 'enter_short' | 'exit' | 'hold';

export interface StrategySignal {
  id: string;
  exchange: ExchangeId;
  symbol: string;
  action: SignalAction;
  /** Estimated win probability for Kelly sizing (0–1) */
  winProbability: number;
  /** Reward-to-risk ratio (take-profit distance / stop-loss distance) */
  riskRewardRatio: number;
  /** Suggested stop-loss price */
  stopLoss?: number;
  /** Suggested take-profit price */
  takeProfit?: number;
  /** Strategy confidence 0–1 */
  confidence: number;
  reason: string;
  timestamp: number;
}

export interface RiskDecision {
  approved: boolean;
  reason: string;
  adjustedQuantity?: number;
  adjustedLeverage?: number;
  killSwitchActive?: boolean;
}

export interface BotConfig {
  exchange: ExchangeId;
  symbols: string[];
  paperTrading: boolean;
  testnet: boolean;
  maxLeverage: number;
  maxPositionSizeUsd: number;
  maxDailyLossUsd: number;
  maxOpenPositions: number;
  cooldownMs: number;
  kellyFraction: number;
  minStakeUsd: number;
  apiErrorKillThreshold: number;
  strategy: {
    lookbackPeriods: number;
    breakoutMultiplier: number;
    minConfidence: number;
  };
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // OKX
}

export interface PlaceOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  positionSide?: PositionSide;
  timeInForce?: TimeInForce;
}

export interface ApiError extends Error {
  code: string | number;
  exchange: ExchangeId;
  retryable: boolean;
}

export function createApiError(
  exchange: ExchangeId,
  message: string,
  code: string | number,
  retryable = false,
): ApiError {
  const err = new Error(message) as ApiError;
  err.name = 'ApiError';
  err.exchange = exchange;
  err.code = code;
  err.retryable = retryable;
  return err;
}
