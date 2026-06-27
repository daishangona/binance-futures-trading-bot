import type { BotConfig, RiskDecision, StrategySignal } from '../core/types.js';
import type { StateStore } from '../state/store.js';
import { computeFuturesKellyStake, stakeToQuantity } from './position-sizing.js';

export class RiskService {
  constructor(
    private readonly config: BotConfig,
    private readonly store: StateStore,
  ) {}

  evaluate(signal: StrategySignal, markPrice: number): RiskDecision {
    this.store.resetDailyIfNeeded();
    const snapshot = this.store.getSnapshot();

    if (snapshot.killSwitchActive) {
      return {
        approved: false,
        reason: snapshot.killSwitchReason ?? 'Kill switch active',
        killSwitchActive: true,
      };
    }

    if (snapshot.dailyStats.realizedPnl <= -this.config.maxDailyLossUsd) {
      this.store.activateKillSwitch(`Daily loss limit reached: ${snapshot.dailyStats.realizedPnl}`);
      return {
        approved: false,
        reason: 'Daily loss limit breached',
        killSwitchActive: true,
      };
    }

    if (snapshot.consecutiveApiErrors >= this.config.apiErrorKillThreshold) {
      this.store.activateKillSwitch(`API error threshold: ${snapshot.consecutiveApiErrors}`);
      return {
        approved: false,
        reason: 'Too many consecutive API errors',
        killSwitchActive: true,
      };
    }

    if (signal.action === 'hold' || signal.action === 'exit') {
      return { approved: signal.action === 'exit', reason: 'Exit signal' };
    }

    const openPositions = this.store.getOpenPositions();
    if (openPositions.length >= this.config.maxOpenPositions) {
      return { approved: false, reason: 'Max open positions reached' };
    }

    const lastTrade = this.store.getLastTradeAt(signal.symbol);
    if (lastTrade && Date.now() - lastTrade < this.config.cooldownMs) {
      return { approved: false, reason: 'Cooldown active' };
    }

    if (signal.confidence < this.config.strategy.minConfidence) {
      return { approved: false, reason: 'Signal confidence below threshold' };
    }

    const equity = this.store.getEquityUsd();
    if (equity <= 0) {
      return { approved: false, reason: 'No available equity' };
    }

    const stakeUsd = computeFuturesKellyStake({
      winProbability: signal.winProbability,
      riskRewardRatio: signal.riskRewardRatio,
      bankroll: equity,
      maxStakeUsd: Math.min(this.config.maxPositionSizeUsd, equity * 0.25),
      minStakeUsd: this.config.minStakeUsd,
      kellyFraction: this.config.kellyFraction,
    });

    if (stakeUsd < this.config.minStakeUsd) {
      return { approved: false, reason: 'Kelly stake below minimum' };
    }

    const leverage = Math.min(this.config.maxLeverage, 10);
    const quantity = stakeToQuantity(stakeUsd, markPrice, leverage);

    const notional = quantity * markPrice;
    if (notional > this.config.maxPositionSizeUsd) {
      return {
        approved: false,
        reason: `Notional ${notional.toFixed(2)} exceeds max position size`,
      };
    }

    return {
      approved: true,
      reason: `Kelly stake $${stakeUsd.toFixed(2)} @ ${leverage}x`,
      adjustedQuantity: quantity,
      adjustedLeverage: leverage,
    };
  }
}
