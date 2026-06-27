declare module 'stake-math' {
  export interface KellyStakeInput {
    probability: number;
    allInPrice: number;
    bankroll: number;
    maxStake: number;
    minStake?: number;
    kellyFraction?: number;
  }

  export function computeKellyStake(input: KellyStakeInput): number;
  export function formatStakeUsd(value: number): string;
  export function roundStake(value: number): number;
}
