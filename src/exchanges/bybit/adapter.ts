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
  sideToBybit,
} from '../common/http.js';
import { ReconnectingWebSocket } from '../common/websocket.js';
import type { ExchangeAdapter } from '../types.js';

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

export class BybitAdapter implements ExchangeAdapter {
  readonly id: ExchangeId = 'bybit';
  private readonly baseUrl: string;
  private readonly wsPublic: string;
  private readonly wsPrivate: string;
  private marketWs: ReconnectingWebSocket | null = null;
  private privateWs: ReconnectingWebSocket | null = null;

  constructor(
    private readonly credentials: ExchangeCredentials,
    private readonly testnet: boolean,
    private readonly paperTrading: boolean,
    private readonly events: EventBus,
  ) {
    const urls = EXCHANGE_URLS.bybit;
    this.baseUrl = testnet ? urls.rest.testnet : urls.rest.live;
    this.wsPublic = testnet ? urls.ws.testnet : urls.ws.live;
    this.wsPrivate = testnet ? urls.privateWs.testnet : urls.privateWs.live;
  }

  normalizeSymbol(symbol: string): string {
    return symbol.toUpperCase().replace(/[-_/]/g, '');
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const timestamp = String(nowMs());
    const recvWindow = '5000';
    const query = buildQuery(params);
    const payload = timestamp + this.credentials.apiKey + recvWindow + (method === 'GET' ? query : JSON.stringify(params));
    const sign = hmacSha256(this.credentials.apiSecret, payload);

    const url = method === 'GET' && query ? `${this.baseUrl}${path}?${query}` : `${this.baseUrl}${path}`;
    const body = await httpRequest<BybitResponse<T>>(url, {
      method,
      headers: {
        'X-BAPI-API-KEY': this.credentials.apiKey,
        'X-BAPI-SIGN': sign,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(params) : undefined,
    });

    if (body.retCode !== 0) {
      throw createApiError('bybit', body.retMsg, body.retCode, body.retCode === 10006);
    }
    return body.result;
  }

  async connectMarketData(symbols: string[]): Promise<void> {
    this.marketWs = new ReconnectingWebSocket(this.wsPublic, {
      onOpen: (ws) => {
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: symbols.flatMap((s) => {
            const sym = this.normalizeSymbol(s);
            return [
              `orderbook.50.${sym}`,
              `tickers.${sym}`,
            ];
          }),
        }));
      },
      onMessage: (data) => this.handleMarketMessage(data),
      onError: (err) =>
        this.events.emit('error', { source: 'bybit-ws', message: err.message, timestamp: nowMs() }),
      onClose: () => {},
    });
    this.marketWs.connect();
  }

  private handleMarketMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const msg = data as { topic?: string; data?: Record<string, unknown> | Record<string, unknown>[] };
    if (!msg.topic || !msg.data) return;

    if (msg.topic.startsWith('tickers.')) {
      const d = msg.data as Record<string, unknown>;
      const symbol = String(d.symbol);
      const ticker: Ticker = {
        exchange: 'bybit',
        symbol,
        bid: Number(d.bid1Price ?? d.lastPrice),
        ask: Number(d.ask1Price ?? d.lastPrice),
        last: Number(d.lastPrice),
        markPrice: Number(d.markPrice),
        indexPrice: Number(d.indexPrice),
        fundingRate: Number(d.fundingRate),
        timestamp: nowMs(),
      };
      this.events.emit('ticker', ticker);
      return;
    }

    if (msg.topic.startsWith('orderbook.')) {
      const d = msg.data as { s: string; b: string[][]; a: string[][] };
      const book: OrderBook = {
        exchange: 'bybit',
        symbol: d.s,
        bids: d.b.map(([price, qty]) => ({ price: Number(price), quantity: Number(qty) })),
        asks: d.a.map(([price, qty]) => ({ price: Number(price), quantity: Number(qty) })),
        timestamp: nowMs(),
      };
      this.events.emit('orderbook', book);
    }
  }

  async connectPrivateStreams(): Promise<void> {
    if (this.paperTrading) return;

    this.privateWs = new ReconnectingWebSocket(this.wsPrivate, {
      onOpen: (ws) => {
        const expires = nowMs() + 10_000;
        const sign = hmacSha256(this.credentials.apiSecret, `GET/realtime${expires}`);
        ws.send(JSON.stringify({ op: 'auth', args: [this.credentials.apiKey, expires, sign] }));
        ws.send(JSON.stringify({ op: 'subscribe', args: ['order', 'execution'] }));
      },
      onMessage: (data) => this.handlePrivateMessage(data),
      onError: (err) =>
        this.events.emit('error', { source: 'bybit-private-ws', message: err.message, timestamp: nowMs() }),
      onClose: () => {},
    });
    this.privateWs.connect();
  }

  private handlePrivateMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const msg = data as { topic?: string; data?: Array<Record<string, unknown>> };
    if (msg.topic === 'execution' && Array.isArray(msg.data)) {
      for (const e of msg.data) {
        const fill: Fill = {
          exchange: 'bybit',
          symbol: String(e.symbol),
          orderId: String(e.orderId),
          clientOrderId: String(e.orderLinkId),
          side: String(e.side).toLowerCase() === 'buy' ? 'buy' : 'sell',
          price: Number(e.execPrice),
          quantity: Number(e.execQty),
          fee: Number(e.execFee),
          feeAsset: String(e.feeRate ? 'USDT' : 'USDT'),
          timestamp: Number(e.execTime),
        };
        this.events.emit('fill', fill);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.marketWs?.close();
    this.privateWs?.close();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const sym = this.normalizeSymbol(symbol);
    const result = await this.signedRequest<{ list: Array<Record<string, string>> }>(
      'GET',
      '/v5/market/tickers',
      { category: 'linear', symbol: sym },
    );
    const d = result.list[0];
    return {
      exchange: 'bybit',
      symbol: sym,
      bid: Number(d.bid1Price),
      ask: Number(d.ask1Price),
      last: Number(d.lastPrice),
      markPrice: Number(d.markPrice),
      fundingRate: Number(d.fundingRate),
      timestamp: nowMs(),
    };
  }

  async getOrderBook(symbol: string, depth = 10): Promise<OrderBook> {
    const sym = this.normalizeSymbol(symbol);
    const result = await this.signedRequest<{ s: string; b: string[][]; a: string[][] }>(
      'GET',
      '/v5/market/orderbook',
      { category: 'linear', symbol: sym, limit: depth },
    );
    return {
      exchange: 'bybit',
      symbol: sym,
      bids: result.b.map(([p, q]) => ({ price: Number(p), quantity: Number(q) })),
      asks: result.a.map(([p, q]) => ({ price: Number(p), quantity: Number(q) })),
      timestamp: nowMs(),
    };
  }

  async getPositions(symbols?: string[]): Promise<Position[]> {
    if (this.paperTrading) return [];

    const result = await this.signedRequest<{ list: Array<Record<string, string>> }>(
      'GET',
      '/v5/position/list',
      { category: 'linear', settleCoin: 'USDT' },
    );

    return result.list
      .filter((p) => Number(p.size) !== 0)
      .filter((p) => !symbols || symbols.map((s) => this.normalizeSymbol(s)).includes(p.symbol))
      .map((p) => ({
        exchange: 'bybit' as const,
        symbol: p.symbol,
        side: p.side === 'Buy' ? 'long' : 'short',
        quantity: Number(p.size),
        entryPrice: Number(p.avgPrice),
        markPrice: Number(p.markPrice),
        unrealizedPnl: Number(p.unrealisedPnl),
        leverage: Number(p.leverage),
        liquidationPrice: Number(p.liqPrice) || undefined,
        updatedAt: nowMs(),
      }));
  }

  async getBalances(): Promise<AccountBalance[]> {
    if (this.paperTrading) {
      return [{
        exchange: 'bybit',
        asset: 'USDT',
        walletBalance: 10_000,
        availableBalance: 10_000,
        unrealizedPnl: 0,
        marginBalance: 10_000,
        updatedAt: nowMs(),
      }];
    }

    const result = await this.signedRequest<{ list: Array<Record<string, string>> }>(
      'GET',
      '/v5/account/wallet-balance',
      { accountType: 'UNIFIED' },
    );

    const account = result.list[0];
    const coinList = (account?.coin ?? []) as Array<Record<string, string>>;
    return coinList.map((c) => ({
      exchange: 'bybit' as const,
      asset: c.coin,
      walletBalance: Number(c.walletBalance),
      availableBalance: Number(c.availableToWithdraw ?? c.availableBalance),
      unrealizedPnl: Number(c.unrealisedPnl ?? 0),
      marginBalance: Number(c.equity ?? c.walletBalance),
      updatedAt: nowMs(),
    }));
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (this.paperTrading) return;
    const sym = this.normalizeSymbol(symbol);
    await this.signedRequest('POST', '/v5/position/set-leverage', {
      category: 'linear',
      symbol: sym,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage),
    });
  }

  async placeOrder(order: PlaceOrderRequest): Promise<NormalizedOrder> {
    const sym = this.normalizeSymbol(order.symbol);
    const typeMap: Record<string, string> = {
      market: 'Market',
      limit: 'Limit',
      stop_market: 'Market',
      take_profit_market: 'Market',
    };

    if (this.paperTrading) {
      const ticker = await this.getTicker(sym);
      const fillPrice = order.side === 'buy' ? ticker.ask : ticker.bid;
      return {
        clientOrderId: order.clientOrderId,
        exchangeOrderId: `paper_${Date.now()}`,
        exchange: 'bybit',
        symbol: sym,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        price: order.price,
        stopPrice: order.stopPrice,
        reduceOnly: order.reduceOnly,
        status: 'filled',
        filledQuantity: order.quantity,
        avgFillPrice: fillPrice,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      };
    }

    const params: Record<string, string | number | boolean | undefined> = {
      category: 'linear',
      symbol: sym,
      side: sideToBybit(order.side),
      orderType: typeMap[order.type],
      qty: String(order.quantity),
      orderLinkId: order.clientOrderId,
      reduceOnly: order.reduceOnly,
      price: order.price !== undefined ? String(order.price) : undefined,
      triggerPrice: order.stopPrice !== undefined ? String(order.stopPrice) : undefined,
      timeInForce: order.timeInForce ?? 'GTC',
    };

    const result = await this.signedRequest<Record<string, string>>('POST', '/v5/order/create', params);
    return {
      clientOrderId: order.clientOrderId,
      exchangeOrderId: result.orderId,
      exchange: 'bybit',
      symbol: sym,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      price: order.price,
      stopPrice: order.stopPrice,
      reduceOnly: order.reduceOnly,
      status: 'open',
      filledQuantity: 0,
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
  }

  async cancelOrder(symbol: string, clientOrderId: string): Promise<void> {
    if (this.paperTrading) return;
    await this.signedRequest('POST', '/v5/order/cancel', {
      category: 'linear',
      symbol: this.normalizeSymbol(symbol),
      orderLinkId: clientOrderId,
    });
  }

  async getOrder(symbol: string, clientOrderId: string): Promise<NormalizedOrder> {
    if (this.paperTrading) {
      throw createApiError('bybit', 'Paper mode: order lookup not tracked', 'PAPER');
    }
    const result = await this.signedRequest<{ list: Array<Record<string, string>> }>(
      'GET',
      '/v5/order/realtime',
      { category: 'linear', symbol: this.normalizeSymbol(symbol), orderLinkId: clientOrderId },
    );
    const o = result.list[0];
    return {
      clientOrderId: o.orderLinkId,
      exchangeOrderId: o.orderId,
      exchange: 'bybit',
      symbol: o.symbol,
      side: o.side.toLowerCase() === 'buy' ? 'buy' : 'sell',
      type: o.orderType.toLowerCase().includes('market') ? 'market' : 'limit',
      quantity: Number(o.qty),
      price: Number(o.price) || undefined,
      status: mapOrderStatus(o.orderStatus),
      filledQuantity: Number(o.cumExecQty),
      avgFillPrice: Number(o.avgPrice) || undefined,
      createdAt: Number(o.createdTime),
      updatedAt: Number(o.updatedTime),
    };
  }
}

export function createBybitAdapter(
  credentials: ExchangeCredentials,
  testnet: boolean,
  paperTrading: boolean,
  events: EventBus,
): ExchangeAdapter {
  return new BybitAdapter(credentials, testnet, paperTrading, events);
}
