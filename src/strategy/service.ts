import type { BotConfig, StrategySignal, Ticker } from '../core/types.js';
import type { EventBus } from '../core/events.js';
import type { StateStore } from '../state/store.js';

interface PriceWindow {
  prices: number[];
  maxLen: number;
}

/**
 * Momentum breakout strategy with optional funding-rate bias.
 * Generates normalized signals — never touches exchange-specific payloads.
 */
export class StrategyService {
  private readonly windows = new Map<string, PriceWindow>();

  constructor(
    private readonly config: BotConfig,
    private readonly store: StateStore,
    private readonly events: EventBus,
  ) {
    this.events.on('ticker', (ticker) => this.onTicker(ticker));
  }

  private onTicker(ticker: Ticker): void {
    this.store.setTicker(ticker);
    const signal = this.evaluate(ticker);
    if (signal) {
      this.store.setSignal(signal);
      this.events.emit('signal', signal);
    }
  }

  evaluate(ticker: Ticker): StrategySignal | null {
    const key = `${ticker.exchange}:${ticker.symbol}`;
    const price = ticker.markPrice ?? ticker.last;
    if (!price || price <= 0) return null;

    let window = this.windows.get(key);
    if (!window) {
      window = { prices: [], maxLen: this.config.strategy.lookbackPeriods };
      this.windows.set(key, window);
    }

    window.prices.push(price);
    if (window.prices.length > window.maxLen) {
      window.prices.shift();
    }

    if (window.prices.length < window.maxLen) return null;

    const mean = window.prices.reduce((a, b) => a + b, 0) / window.prices.length;
    const variance =
      window.prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / window.prices.length;
    const stdDev = Math.sqrt(variance);
    const upper = mean + stdDev * this.config.strategy.breakoutMultiplier;
    const lower = mean - stdDev * this.config.strategy.breakoutMultiplier;

    const existing = this.store.getOpenPositions().find(
      (p) => p.exchange === ticker.exchange && p.symbol === ticker.symbol,
    );

    if (existing) {
      const shouldExit =
        (existing.side === 'long' && price < mean) ||
        (existing.side === 'short' && price > mean);
      if (shouldExit) {
        return this.buildSignal(ticker, 'exit', 0.5, 1, 0.6, 'Mean reversion exit');
      }
      return null;
    }

    const fundingBias =
      ticker.fundingRate !== undefined
        ? ticker.fundingRate > 0.0001
          ? -0.05
          : ticker.fundingRate < -0.0001
            ? 0.05
            : 0
        : 0;

    if (price > upper) {
      const winProb = Math.min(0.75, 0.52 + fundingBias);
      const confidence = Math.min(0.95, (price - upper) / upper + 0.55);
      return this.buildSignal(
        ticker,
        'enter_long',
        winProb,
        2,
        confidence,
        `Breakout above ${upper.toFixed(2)}`,
        price - stdDev * 2,
        price + stdDev * 4,
      );
    }

    if (price < lower) {
      const winProb = Math.min(0.75, 0.52 - fundingBias);
      const confidence = Math.min(0.95, (lower - price) / lower + 0.55);
      return this.buildSignal(
        ticker,
        'enter_short',
        winProb,
        2,
        confidence,
        `Breakout below ${lower.toFixed(2)}`,
        price + stdDev * 2,
        price - stdDev * 4,
      );
    }

    return null;
  }

  private buildSignal(
    ticker: Ticker,
    action: StrategySignal['action'],
    winProbability: number,
    riskRewardRatio: number,
    confidence: number,
    reason: string,
    stopLoss?: number,
    takeProfit?: number,
  ): StrategySignal {
    return {
      id: `${ticker.exchange}_${ticker.symbol}_${Date.now()}`,
      exchange: ticker.exchange,
      symbol: ticker.symbol,
      action,
      winProbability,
      riskRewardRatio,
      stopLoss,
      takeProfit,
      confidence,
      reason,
      timestamp: Date.now(),
    };
  }
}
