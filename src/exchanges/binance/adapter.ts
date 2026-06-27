import { EXCHANGE_URLS } from '../../config/index.js';
import type {
  AccountBalance,
  ExchangeCredentials,
  ExchangeId,
  Fill,
  NormalizedOrder,
  OrderBook,
  PlaceOrderRequest,
  Position,
  Side,
  Ticker,
} from '../../core/types.js';
import { createApiError } from '../../core/types.js';
import type { EventBus } from '../../core/events.js';
import {
  buildQuery,
  hmacSha256,
  httpRequest,
  mapOrderStatus,
  nowMs,
  sideToBinance,
} from '../common/http.js';
import { ReconnectingWebSocket } from '../common/websocket.js';
import type { ExchangeAdapter } from '../types.js';

interface BinanceOrderResponse {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: string;
  type: string;
  origQty: string;
  price: string;
  stopPrice?: string;
  status: string;
  executedQty: string;
  avgPrice: string;
  updateTime: number;
  reduceOnly?: boolean;
  positionSide?: string;
}

export class BinanceAdapter implements ExchangeAdapter {
  readonly id: ExchangeId = 'binance';
  private readonly baseUrl: string;
  private readonly wsBase: string;
  private marketWs: ReconnectingWebSocket | null = null;
  private userWs: ReconnectingWebSocket | null = null;
  private listenKey: string | null = null;
  private listenKeyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly credentials: ExchangeCredentials,
    private readonly testnet: boolean,
    private readonly paperTrading: boolean,
    private readonly events: EventBus,
  ) {
    const urls = EXCHANGE_URLS.binance;
    this.baseUrl = testnet ? urls.rest.testnet : urls.rest.live;
    this.wsBase = testnet ? urls.ws.testnet : urls.ws.live;
  }

  normalizeSymbol(symbol: string): string {
    return symbol.toUpperCase().replace(/[-_/]/g, '');
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const timestamp = nowMs();
    const query = buildQuery({ ...params, timestamp, recvWindow: 5000 });
    const signature = hmacSha256(this.credentials.apiSecret, query);
    const url = `${this.baseUrl}${path}?${query}&signature=${signature}`;

    const body = await httpRequest<T & { code?: number; msg?: string }>(url, {
      method,
      headers: { 'X-MBX-APIKEY': this.credentials.apiKey },
    });

    if (typeof body === 'object' && body && 'code' in body && body.code && body.code !== 200) {
      throw createApiError('binance', body.msg ?? 'Binance API error', body.code, body.code === -1003);
    }
    return body;
  }

  async connectMarketData(symbols: string[]): Promise<void> {
    const streams = symbols.flatMap((s) => {
      const sym = this.normalizeSymbol(s).toLowerCase();
      return [
        `${sym}@bookTicker`,
        `${sym}@markPrice@1s`,
        `${sym}@depth10@100ms`,
      ];
    });

    const url = `${this.wsBase}/stream?streams=${streams.join('/')}`;
    this.marketWs = new ReconnectingWebSocket(url, {
      onMessage: (data) => this.handleMarketMessage(data),
      onError: (err) =>
        this.events.emit('error', { source: 'binance-ws', message: err.message, timestamp: nowMs() }),
      onClose: () => {},
    });
    this.marketWs.connect();
  }

  private handleMarketMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const envelope = data as { stream?: string; data?: Record<string, unknown> };
    const payload = envelope.data ?? (data as Record<string, unknown>);
    const stream = envelope.stream ?? '';

    if (stream.includes('bookTicker') || ('b' in payload && 'a' in payload && 's' in payload)) {
      const symbol = String(payload.s);
      const ticker: Ticker = {
        exchange: 'binance',
        symbol,
        bid: Number(payload.b),
        ask: Number(payload.a),
        last: (Number(payload.b) + Number(payload.a)) / 2,
        timestamp: nowMs(),
      };
      this.events.emit('ticker', ticker);
      return;
    }

    if (stream.includes('markPrice') || 'p' in payload && 'r' in payload) {
      const symbol = String(payload.s);
      const ticker: Ticker = {
        exchange: 'binance',
        symbol,
        bid: Number(payload.i ?? payload.p),
        ask: Number(payload.i ?? payload.p),
        last: Number(payload.p),
        markPrice: Number(payload.p),
        indexPrice: Number(payload.i),
        fundingRate: Number(payload.r),
        nextFundingTime: Number(payload.T),
        timestamp: nowMs(),
      };
      this.events.emit('ticker', ticker);
      return;
    }

    if (stream.includes('depth') || ('bids' in payload && 'asks' in payload)) {
      const symbol = String(payload.s ?? '').toUpperCase();
      if (!symbol) return;
      const book: OrderBook = {
        exchange: 'binance',
        symbol,
        bids: (payload.bids as string[][]).map(([price, qty]) => ({
          price: Number(price),
          quantity: Number(qty),
        })),
        asks: (payload.asks as string[][]).map(([price, qty]) => ({
          price: Number(price),
          quantity: Number(qty),
        })),
        timestamp: nowMs(),
      };
      this.events.emit('orderbook', book);
    }
  }

  async connectPrivateStreams(): Promise<void> {
    if (this.paperTrading) return;

    const res = await httpRequest<{ listenKey: string }>(`${this.baseUrl}/fapi/v1/listenKey`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': this.credentials.apiKey },
    });
    this.listenKey = res.listenKey;

    this.listenKeyTimer = setInterval(async () => {
      if (!this.listenKey) return;
      await httpRequest(`${this.baseUrl}/fapi/v1/listenKey`, {
        method: 'PUT',
        headers: { 'X-MBX-APIKEY': this.credentials.apiKey },
      });
    }, 30 * 60 * 1000);

    const url = `${this.wsBase}/ws/${this.listenKey}`;
    this.userWs = new ReconnectingWebSocket(url, {
      onMessage: (data) => this.handleUserMessage(data),
      onError: (err) =>
        this.events.emit('error', { source: 'binance-user-ws', message: err.message, timestamp: nowMs() }),
      onClose: () => {},
    });
    this.userWs.connect();
  }

  private handleUserMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const msg = data as { e?: string; o?: BinanceOrderResponse };
    if (msg.e === 'ORDER_TRADE_UPDATE' && msg.o) {
      const o = msg.o;
      if (Number(o.executedQty) > 0 && Number(o.avgPrice) > 0) {
        const fill: Fill = {
          exchange: 'binance',
          symbol: o.symbol,
          orderId: String(o.orderId),
          clientOrderId: o.clientOrderId,
          side: o.side === 'BUY' ? 'buy' : 'sell',
          price: Number(o.avgPrice),
          quantity: Number(o.executedQty),
          fee: 0,
          feeAsset: 'USDT',
          timestamp: o.updateTime,
        };
        this.events.emit('fill', fill);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.marketWs?.close();
    this.userWs?.close();
    if (this.listenKeyTimer) clearInterval(this.listenKeyTimer);
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const sym = this.normalizeSymbol(symbol);
    const data = await httpRequest<{ symbol: string; bidPrice: string; askPrice: string; lastPrice: string }>(
      `${this.baseUrl}/fapi/v1/ticker/bookTicker?symbol=${sym}`,
    );
    return {
      exchange: 'binance',
      symbol: sym,
      bid: Number(data.bidPrice),
      ask: Number(data.askPrice),
      last: Number(data.lastPrice ?? (Number(data.bidPrice) + Number(data.askPrice)) / 2),
      timestamp: nowMs(),
    };
  }

  async getOrderBook(symbol: string, depth = 10): Promise<OrderBook> {
    const sym = this.normalizeSymbol(symbol);
    const data = await httpRequest<{ bids: string[][]; asks: string[][] }>(
      `${this.baseUrl}/fapi/v1/depth?symbol=${sym}&limit=${depth}`,
    );
    return {
      exchange: 'binance',
      symbol: sym,
      bids: data.bids.map(([p, q]) => ({ price: Number(p), quantity: Number(q) })),
      asks: data.asks.map(([p, q]) => ({ price: Number(p), quantity: Number(q) })),
      timestamp: nowMs(),
    };
  }

  async getPositions(symbols?: string[]): Promise<Position[]> {
    if (this.paperTrading) return [];

    const data = await this.signedRequest<Array<{
      symbol: string;
      positionAmt: string;
      entryPrice: string;
      markPrice: string;
      unRealizedProfit: string;
      leverage: string;
      liquidationPrice: string;
      positionSide: string;
    }>>('GET', '/fapi/v2/positionRisk');

    return data
      .filter((p) => Number(p.positionAmt) !== 0)
      .filter((p) => !symbols || symbols.map((s) => this.normalizeSymbol(s)).includes(p.symbol))
      .map((p) => ({
        exchange: 'binance' as const,
        symbol: p.symbol,
        side: Number(p.positionAmt) > 0 ? 'long' : 'short',
        quantity: Math.abs(Number(p.positionAmt)),
        entryPrice: Number(p.entryPrice),
        markPrice: Number(p.markPrice),
        unrealizedPnl: Number(p.unRealizedProfit),
        leverage: Number(p.leverage),
        liquidationPrice: Number(p.liquidationPrice) || undefined,
        updatedAt: nowMs(),
      }));
  }

  async getBalances(): Promise<AccountBalance[]> {
    if (this.paperTrading) {
      return [{
        exchange: 'binance',
        asset: 'USDT',
        walletBalance: 10_000,
        availableBalance: 10_000,
        unrealizedPnl: 0,
        marginBalance: 10_000,
        updatedAt: nowMs(),
      }];
    }

    const data = await this.signedRequest<Array<{
      asset: string;
      walletBalance: string;
      availableBalance: string;
      unrealizedProfit: string;
      marginBalance: string;
    }>>('GET', '/fapi/v2/balance');

    return data.map((b) => ({
      exchange: 'binance' as const,
      asset: b.asset,
      walletBalance: Number(b.walletBalance),
      availableBalance: Number(b.availableBalance),
      unrealizedPnl: Number(b.unrealizedProfit),
      marginBalance: Number(b.marginBalance),
      updatedAt: nowMs(),
    }));
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (this.paperTrading) return;
    await this.signedRequest('POST', '/fapi/v1/leverage', {
      symbol: this.normalizeSymbol(symbol),
      leverage,
    });
  }

  async placeOrder(order: PlaceOrderRequest): Promise<NormalizedOrder> {
    const sym = this.normalizeSymbol(order.symbol);
    const typeMap: Record<string, string> = {
      market: 'MARKET',
      limit: 'LIMIT',
      stop_market: 'STOP_MARKET',
      take_profit_market: 'TAKE_PROFIT_MARKET',
    };

    if (this.paperTrading) {
      const ticker = await this.getTicker(sym);
      const fillPrice = order.side === 'buy' ? ticker.ask : ticker.bid;
      return {
        clientOrderId: order.clientOrderId,
        exchangeOrderId: `paper_${Date.now()}`,
        exchange: 'binance',
        symbol: sym,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        price: order.price,
        stopPrice: order.stopPrice,
        reduceOnly: order.reduceOnly,
        positionSide: order.positionSide,
        status: 'filled',
        filledQuantity: order.quantity,
        avgFillPrice: fillPrice,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      };
    }

    const params: Record<string, string | number | boolean | undefined> = {
      symbol: sym,
      side: sideToBinance(order.side),
      type: typeMap[order.type],
      quantity: order.quantity,
      newClientOrderId: order.clientOrderId,
      reduceOnly: order.reduceOnly,
      positionSide: order.positionSide?.toUpperCase(),
      price: order.price,
      stopPrice: order.stopPrice,
      timeInForce: order.timeInForce,
    };

    const res = await this.signedRequest<BinanceOrderResponse>('POST', '/fapi/v1/order', params);
    return this.normalizeOrder(res);
  }

  async cancelOrder(symbol: string, clientOrderId: string): Promise<void> {
    if (this.paperTrading) return;
    await this.signedRequest('DELETE', '/fapi/v1/order', {
      symbol: this.normalizeSymbol(symbol),
      origClientOrderId: clientOrderId,
    });
  }

  async getOrder(symbol: string, clientOrderId: string): Promise<NormalizedOrder> {
    if (this.paperTrading) {
      throw createApiError('binance', 'Paper mode: order lookup not tracked', 'PAPER');
    }
    const res = await this.signedRequest<BinanceOrderResponse>('GET', '/fapi/v1/order', {
      symbol: this.normalizeSymbol(symbol),
      origClientOrderId: clientOrderId,
    });
    return this.normalizeOrder(res);
  }

  private normalizeOrder(o: BinanceOrderResponse): NormalizedOrder {
    return {
      clientOrderId: o.clientOrderId,
      exchangeOrderId: String(o.orderId),
      exchange: 'binance',
      symbol: o.symbol,
      side: o.side === 'BUY' ? 'buy' : 'sell',
      type: o.type.toLowerCase().includes('market') ? 'market' : 'limit',
      quantity: Number(o.origQty),
      price: Number(o.price) || undefined,
      stopPrice: Number(o.stopPrice) || undefined,
      reduceOnly: o.reduceOnly,
      positionSide: o.positionSide?.toLowerCase() as NormalizedOrder['positionSide'],
      status: mapOrderStatus(o.status),
      filledQuantity: Number(o.executedQty),
      avgFillPrice: Number(o.avgPrice) || undefined,
      createdAt: o.updateTime,
      updatedAt: o.updateTime,
    };
  }
}

export function createBinanceAdapter(
  credentials: ExchangeCredentials,
  testnet: boolean,
  paperTrading: boolean,
  events: EventBus,
): ExchangeAdapter {
  return new BinanceAdapter(credentials, testnet, paperTrading, events);
}

function sideFromBinance(side: string): Side {
  return side === 'BUY' ? 'buy' : 'sell';
}

export { sideFromBinance };
