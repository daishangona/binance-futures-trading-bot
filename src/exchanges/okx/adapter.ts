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
  hmacSha256Base64,
  httpRequest,
  mapOrderStatus,
  nowMs,
  sideToOkx,
} from '../common/http.js';
import { ReconnectingWebSocket } from '../common/websocket.js';
import type { ExchangeAdapter } from '../types.js';

interface OkxResponse<T> {
  code: string;
  msg: string;
  data: T;
}

export class OkxAdapter implements ExchangeAdapter {
  readonly id: ExchangeId = 'okx';
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
    const urls = EXCHANGE_URLS.okx;
    this.baseUrl = urls.rest.live;
    this.wsPublic = testnet ? urls.ws.testnet : urls.ws.live;
    this.wsPrivate = testnet ? urls.privateWs.testnet : urls.privateWs.live;
  }

  /** OKX swap instId format: BTC-USDT-SWAP */
  normalizeSymbol(symbol: string): string {
    const s = symbol.toUpperCase().replace(/[-_/]/g, '');
    if (s.endsWith('SWAP')) {
      const base = s.replace('SWAP', '').replace('USDT', '');
      return `${base}-USDT-SWAP`;
    }
    if (s.includes('-')) return s;
    const base = s.replace('USDT', '');
    return `${base}-USDT-SWAP`;
  }

  private authHeaders(
    method: string,
    path: string,
    body = '',
  ): Record<string, string> {
    const timestamp = new Date().toISOString();
    const prehash = timestamp + method.toUpperCase() + path + body;
    const sign = hmacSha256Base64(this.credentials.apiSecret, prehash);
    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': this.credentials.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.credentials.passphrase ?? '',
      'Content-Type': 'application/json',
    };
    if (this.testnet || this.paperTrading) {
      headers['x-simulated-trading'] = '1';
    }
    return headers;
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const query = buildQuery(params);
    const url = query ? `${this.baseUrl}${path}?${query}` : `${this.baseUrl}${path}`;
    const body = method === 'POST' ? JSON.stringify(params) : '';
    const signPath = query ? `${path}?${query}` : path;

    const res = await httpRequest<OkxResponse<T>>(url, {
      method,
      headers: this.authHeaders(method, signPath, method === 'POST' ? body : ''),
      body: method === 'POST' ? body : undefined,
    });

    if (res.code !== '0') {
      throw createApiError('okx', res.msg, res.code, res.code === '50011');
    }
    return res.data;
  }

  async connectMarketData(symbols: string[]): Promise<void> {
    this.marketWs = new ReconnectingWebSocket(this.wsPublic, {
      onOpen: (ws) => {
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: symbols.flatMap((s) => {
            const instId = this.normalizeSymbol(s);
            return [
              { channel: 'tickers', instId },
              { channel: 'books5', instId },
              { channel: 'mark-price', instId },
              { channel: 'funding-rate', instId },
            ];
          }),
        }));
      },
      onMessage: (data) => this.handleMarketMessage(data),
      onError: (err) =>
        this.events.emit('error', { source: 'okx-ws', message: err.message, timestamp: nowMs() }),
      onClose: () => {},
    });
    this.marketWs.connect();
  }

  private instToCanonical(instId: string): string {
    return instId.replace('-SWAP', '').replace('-', '');
  }

  private handleMarketMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const msg = data as { arg?: { channel: string; instId: string }; data?: Array<Record<string, string>> };
    if (!msg.arg || !msg.data?.length) return;

    const instId = msg.arg.instId;
    const symbol = this.instToCanonical(instId);
    const d = msg.data[0];

    if (msg.arg.channel === 'tickers') {
      const ticker: Ticker = {
        exchange: 'okx',
        symbol,
        bid: Number(d.bidPx),
        ask: Number(d.askPx),
        last: Number(d.last),
        timestamp: nowMs(),
      };
      this.events.emit('ticker', ticker);
      return;
    }

    if (msg.arg.channel === 'mark-price') {
      const ticker: Ticker = {
        exchange: 'okx',
        symbol,
        bid: Number(d.markPx),
        ask: Number(d.markPx),
        last: Number(d.markPx),
        markPrice: Number(d.markPx),
        timestamp: nowMs(),
      };
      this.events.emit('ticker', ticker);
      return;
    }

    if (msg.arg.channel === 'funding-rate') {
      const ticker: Ticker = {
        exchange: 'okx',
        symbol,
        bid: 0,
        ask: 0,
        last: 0,
        fundingRate: Number(d.fundingRate),
        nextFundingTime: Number(d.nextFundingTime),
        timestamp: nowMs(),
      };
      this.events.emit('ticker', ticker);
      return;
    }

    if (msg.arg.channel === 'books5') {
      const book: OrderBook = {
        exchange: 'okx',
        symbol,
        bids: (d.bids as string[][]).map(([price, qty]) => ({
          price: Number(price),
          quantity: Number(qty),
        })),
        asks: (d.asks as string[][]).map(([price, qty]) => ({
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

    this.privateWs = new ReconnectingWebSocket(this.wsPrivate, {
      onOpen: (ws) => {
        const timestamp = Math.floor(nowMs() / 1000).toString();
        const sign = hmacSha256Base64(
          this.credentials.apiSecret,
          timestamp + 'GET' + '/users/self/verify',
        );
        ws.send(JSON.stringify({
          op: 'login',
          args: [{
            apiKey: this.credentials.apiKey,
            passphrase: this.credentials.passphrase ?? '',
            timestamp,
            sign,
          }],
        }));
        ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'orders', instType: 'SWAP' }] }));
      },
      onMessage: (data) => this.handlePrivateMessage(data),
      onError: (err) =>
        this.events.emit('error', { source: 'okx-private-ws', message: err.message, timestamp: nowMs() }),
      onClose: () => {},
    });
    this.privateWs.connect();
  }

  private handlePrivateMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const msg = data as { arg?: { channel: string }; data?: Array<Record<string, string>> };
    if (msg.arg?.channel === 'orders' && msg.data) {
      for (const o of msg.data) {
        if (Number(o.fillSz) > 0) {
          const fill: Fill = {
            exchange: 'okx',
            symbol: this.instToCanonical(o.instId),
            orderId: o.ordId,
            clientOrderId: o.clOrdId,
            side: o.side as 'buy' | 'sell',
            price: Number(o.fillPx),
            quantity: Number(o.fillSz),
            fee: Number(o.fee),
            feeAsset: o.feeCcy ?? 'USDT',
            timestamp: Number(o.uTime),
          };
          this.events.emit('fill', fill);
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    this.marketWs?.close();
    this.privateWs?.close();
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const instId = this.normalizeSymbol(symbol);
    const data = await this.publicRequest<Array<Record<string, string>>>(
      'GET',
      '/api/v5/market/ticker',
      { instId },
    );
    const d = data[0];
    return {
      exchange: 'okx',
      symbol: this.instToCanonical(instId),
      bid: Number(d.bidPx),
      ask: Number(d.askPx),
      last: Number(d.last),
      timestamp: nowMs(),
    };
  }

  private async publicRequest<T>(
    method: 'GET',
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const query = buildQuery(params);
    const res = await httpRequest<OkxResponse<T>>(`${this.baseUrl}${path}?${query}`, {
      method,
      headers: this.testnet ? { 'x-simulated-trading': '1' } : {},
    });
    if (res.code !== '0') throw createApiError('okx', res.msg, res.code);
    return res.data;
  }

  async getOrderBook(symbol: string, depth = 5): Promise<OrderBook> {
    const instId = this.normalizeSymbol(symbol);
    const data = await this.publicRequest<Array<{ bids: string[][]; asks: string[][] }>>(
      'GET',
      '/api/v5/market/books',
      { instId, sz: depth },
    );
    const d = data[0];
    return {
      exchange: 'okx',
      symbol: this.instToCanonical(instId),
      bids: d.bids.map(([p, q]) => ({ price: Number(p), quantity: Number(q) })),
      asks: d.asks.map(([p, q]) => ({ price: Number(p), quantity: Number(q) })),
      timestamp: nowMs(),
    };
  }

  async getPositions(symbols?: string[]): Promise<Position[]> {
    if (this.paperTrading) return [];

    const data = await this.signedRequest<Array<Record<string, string>>>(
      'GET',
      '/api/v5/account/positions',
      { instType: 'SWAP' },
    );

    return data
      .filter((p) => Number(p.pos) !== 0)
      .filter((p) => !symbols || symbols.map((s) => this.normalizeSymbol(s)).includes(p.instId))
      .map((p) => ({
        exchange: 'okx' as const,
        symbol: this.instToCanonical(p.instId),
        side: Number(p.pos) > 0 ? 'long' : 'short',
        quantity: Math.abs(Number(p.pos)),
        entryPrice: Number(p.avgPx),
        markPrice: Number(p.markPx),
        unrealizedPnl: Number(p.upl),
        leverage: Number(p.lever),
        liquidationPrice: Number(p.liqPx) || undefined,
        updatedAt: nowMs(),
      }));
  }

  async getBalances(): Promise<AccountBalance[]> {
    if (this.paperTrading) {
      return [{
        exchange: 'okx',
        asset: 'USDT',
        walletBalance: 10_000,
        availableBalance: 10_000,
        unrealizedPnl: 0,
        marginBalance: 10_000,
        updatedAt: nowMs(),
      }];
    }

    const data = await this.signedRequest<Array<{ details: Array<Record<string, string>> }>>(
      'GET',
      '/api/v5/account/balance',
    );

    const details = data[0]?.details ?? [];
    return details.map((d) => ({
      exchange: 'okx' as const,
      asset: d.ccy,
      walletBalance: Number(d.cashBal),
      availableBalance: Number(d.availBal),
      unrealizedPnl: Number(d.upl ?? 0),
      marginBalance: Number(d.eq ?? d.cashBal),
      updatedAt: nowMs(),
    }));
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (this.paperTrading) return;
    const instId = this.normalizeSymbol(symbol);
    await this.signedRequest('POST', '/api/v5/account/set-leverage', {
      instId,
      lever: String(leverage),
      mgnMode: 'cross',
    });
  }

  async placeOrder(order: PlaceOrderRequest): Promise<NormalizedOrder> {
    const instId = this.normalizeSymbol(order.symbol);
    const sym = this.instToCanonical(instId);

    const typeMap: Record<string, string> = {
      market: 'market',
      limit: 'limit',
      stop_market: 'market',
      take_profit_market: 'market',
    };

    if (this.paperTrading) {
      const ticker = await this.getTicker(sym);
      const fillPrice = order.side === 'buy' ? ticker.ask : ticker.bid;
      return {
        clientOrderId: order.clientOrderId,
        exchangeOrderId: `paper_${Date.now()}`,
        exchange: 'okx',
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
      instId,
      tdMode: 'cross',
      side: sideToOkx(order.side),
      ordType: typeMap[order.type],
      sz: String(order.quantity),
      clOrdId: order.clientOrderId,
      reduceOnly: order.reduceOnly,
      px: order.price !== undefined ? String(order.price) : undefined,
      slTriggerPx: order.stopPrice !== undefined ? String(order.stopPrice) : undefined,
    };

    const data = await this.signedRequest<Array<{ ordId: string; clOrdId: string }>>(
      'POST',
      '/api/v5/trade/order',
      params,
    );
    const res = data[0];
    return {
      clientOrderId: res.clOrdId,
      exchangeOrderId: res.ordId,
      exchange: 'okx',
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
    await this.signedRequest('POST', '/api/v5/trade/cancel-order', {
      instId: this.normalizeSymbol(symbol),
      clOrdId: clientOrderId,
    });
  }

  async getOrder(symbol: string, clientOrderId: string): Promise<NormalizedOrder> {
    if (this.paperTrading) {
      throw createApiError('okx', 'Paper mode: order lookup not tracked', 'PAPER');
    }
    const data = await this.signedRequest<Array<Record<string, string>>>(
      'GET',
      '/api/v5/trade/order',
      { instId: this.normalizeSymbol(symbol), clOrdId: clientOrderId },
    );
    const o = data[0];
    return {
      clientOrderId: o.clOrdId,
      exchangeOrderId: o.ordId,
      exchange: 'okx',
      symbol: this.instToCanonical(o.instId),
      side: o.side as 'buy' | 'sell',
      type: o.ordType === 'market' ? 'market' : 'limit',
      quantity: Number(o.sz),
      price: Number(o.px) || undefined,
      status: mapOrderStatus(o.state),
      filledQuantity: Number(o.accFillSz),
      avgFillPrice: Number(o.avgPx) || undefined,
      createdAt: Number(o.cTime),
      updatedAt: Number(o.uTime),
    };
  }
}

export function createOkxAdapter(
  credentials: ExchangeCredentials,
  testnet: boolean,
  paperTrading: boolean,
  events: EventBus,
): ExchangeAdapter {
  return new OkxAdapter(credentials, testnet, paperTrading, events);
}
