import type { BotConfig, StrategySignal } from '../core/types.js';
import type { EventBus } from '../core/events.js';
import type { ExchangeAdapter } from '../exchanges/types.js';
import { generateClientOrderId } from '../exchanges/common/http.js';
import type { RiskService } from '../risk/service.js';
import type { StateStore } from '../state/store.js';

export class ExecutionService {
  constructor(
    private readonly config: BotConfig,
    private readonly adapter: ExchangeAdapter,
    private readonly risk: RiskService,
    private readonly store: StateStore,
    private readonly events: EventBus,
  ) {
    this.events.on('signal', (signal) => this.handleSignal(signal));
    this.events.on('fill', (fill) => {
      console.log(
        `[fill] ${fill.exchange} ${fill.symbol} ${fill.side} ${fill.quantity} @ ${fill.price}`,
      );
    });
  }

  private async handleSignal(signal: StrategySignal): Promise<void> {
    try {
      await this.execute(signal);
      this.store.clearApiErrors();
    } catch (err) {
      this.store.recordApiError();
      const message = err instanceof Error ? err.message : String(err);
      this.events.emit('error', { source: 'execution', message, timestamp: Date.now() });
      console.error(`Execution error: ${message}`);
    }
  }

  async execute(signal: StrategySignal): Promise<void> {
    const ticker = this.store.getTicker(signal.exchange, signal.symbol);
    const markPrice = ticker?.markPrice ?? ticker?.last;
    if (!markPrice) {
      console.warn(`No price for ${signal.symbol}, skipping signal`);
      return;
    }

    if (signal.action === 'exit') {
      await this.closePosition(signal);
      return;
    }

    if (signal.action !== 'enter_long' && signal.action !== 'enter_short') return;

    const decision = this.risk.evaluate(signal, markPrice);
    if (!decision.approved) {
      console.log(`[risk] Rejected ${signal.symbol}: ${decision.reason}`);
      return;
    }

    const side = signal.action === 'enter_long' ? 'buy' : 'sell';
    const leverage = decision.adjustedLeverage ?? this.config.maxLeverage;
    const quantity = decision.adjustedQuantity!;

    await this.adapter.setLeverage(signal.symbol, leverage);

    const entryId = generateClientOrderId('entry');
    const entry = await this.adapter.placeOrder({
      clientOrderId: entryId,
      symbol: signal.symbol,
      side,
      type: 'market',
      quantity,
    });
    this.store.upsertOrder(entry);
    this.store.recordTrade(signal.symbol);

    if (signal.stopLoss) {
      const slSide = side === 'buy' ? 'sell' : 'buy';
      const sl = await this.adapter.placeOrder({
        clientOrderId: generateClientOrderId('sl'),
        symbol: signal.symbol,
        side: slSide,
        type: 'stop_market',
        quantity,
        stopPrice: signal.stopLoss,
        reduceOnly: true,
      });
      this.store.upsertOrder(sl);
    }

    if (signal.takeProfit) {
      const tpSide = side === 'buy' ? 'sell' : 'buy';
      const tp = await this.adapter.placeOrder({
        clientOrderId: generateClientOrderId('tp'),
        symbol: signal.symbol,
        side: tpSide,
        type: 'take_profit_market',
        quantity,
        stopPrice: signal.takeProfit,
        reduceOnly: true,
      });
      this.store.upsertOrder(tp);
    }

    console.log(
      `[order] ${signal.action} ${signal.symbol} qty=${quantity.toFixed(6)} @ ~${markPrice} (${decision.reason})`,
    );
  }

  private async closePosition(signal: StrategySignal): Promise<void> {
    const positions = this.store
      .getOpenPositions()
      .filter((p) => p.exchange === signal.exchange && p.symbol === signal.symbol);

    for (const pos of positions) {
      const side = pos.side === 'long' ? 'sell' : 'buy';
      const order = await this.adapter.placeOrder({
        clientOrderId: generateClientOrderId('exit'),
        symbol: signal.symbol,
        side,
        type: 'market',
        quantity: pos.quantity,
        reduceOnly: true,
      });
      this.store.upsertOrder(order);
      this.store.recordTrade(signal.symbol);
      console.log(`[exit] Closed ${pos.side} ${signal.symbol} qty=${pos.quantity}`);
    }
  }
}
