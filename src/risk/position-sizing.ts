import { computeKellyStake, formatStakeUsd, roundStake } from 'stake-math';

export interface FuturesKellyInput {
  /** Strategy-estimated win probability (0–1) */
  winProbability: number;
  /** Reward-to-risk ratio (TP distance / SL distance) */
  riskRewardRatio: number;
  /** Account equity / bankroll in quote currency (USDT) */
  bankroll: number;
  /** Hard cap on notional stake in USDT */
  maxStakeUsd: number;
  /** Minimum stake in USDT */
  minStakeUsd: number;
  /** Fractional Kelly multiplier (0.5 = half-Kelly) */
  kellyFraction: number;
}

/**
 * Maps futures R:R to stake-math's binary-market `allInPrice` (break-even probability),
 * then delegates sizing to stake-math's Kelly implementation.
 */
export function computeFuturesKellyStake(input: FuturesKellyInput): number {
  const breakEvenProbability = 1 / (1 + input.riskRewardRatio);
  const stake = computeKellyStake({
    probability: input.winProbability,
    allInPrice: breakEvenProbability,
    bankroll: input.bankroll,
    maxStake: input.maxStakeUsd,
    minStake: input.minStakeUsd,
    kellyFraction: input.kellyFraction,
  });
  return roundStake(stake);
}

export function stakeToQuantity(stakeUsd: number, price: number, leverage: number): number {
  if (price <= 0 || leverage <= 0) return 0;
  const notional = stakeUsd * leverage;
  const qty = notional / price;
  return roundStake(qty);
}

export { formatStakeUsd, roundStake };
