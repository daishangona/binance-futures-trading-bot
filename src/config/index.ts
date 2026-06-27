import type { BotConfig, ExchangeCredentials, ExchangeId } from '../core/types.js';

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  return v !== undefined && v !== '' ? Number(v) : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

export function loadConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  const exchange = (env('EXCHANGE', 'binance') as ExchangeId) || 'binance';
  const symbols = env('SYMBOLS', 'BTCUSDT,ETHUSDT')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    exchange,
    symbols,
    paperTrading: envBool('PAPER_TRADING', true),
    testnet: envBool('TESTNET', true),
    maxLeverage: envNum('MAX_LEVERAGE', 5),
    maxPositionSizeUsd: envNum('MAX_POSITION_SIZE_USD', 5000),
    maxDailyLossUsd: envNum('MAX_DAILY_LOSS_USD', 500),
    maxOpenPositions: envNum('MAX_OPEN_POSITIONS', 3),
    cooldownMs: envNum('COOLDOWN_MS', 60_000),
    kellyFraction: envNum('KELLY_FRACTION', 0.5),
    minStakeUsd: envNum('MIN_STAKE_USD', 10),
    apiErrorKillThreshold: envNum('API_ERROR_KILL_THRESHOLD', 5),
    strategy: {
      lookbackPeriods: envNum('STRATEGY_LOOKBACK', 20),
      breakoutMultiplier: envNum('STRATEGY_BREAKOUT_MULT', 1.5),
      minConfidence: envNum('STRATEGY_MIN_CONFIDENCE', 0.55),
    },
    ...overrides,
  };
}

export function loadCredentials(exchange: ExchangeId): ExchangeCredentials {
  const prefix = exchange.toUpperCase();
  return {
    apiKey: env(`${prefix}_API_KEY`),
    apiSecret: env(`${prefix}_API_SECRET`),
    passphrase: env(`${prefix}_PASSPHRASE`) || undefined,
  };
}

export const EXCHANGE_URLS = {
  binance: {
    rest: {
      live: 'https://fapi.binance.com',
      testnet: 'https://testnet.binancefuture.com',
    },
    ws: {
      live: 'wss://fstream.binance.com',
      testnet: 'wss://stream.binancefuture.com',
    },
  },
  bybit: {
    rest: {
      live: 'https://api.bybit.com',
      testnet: 'https://api-testnet.bybit.com',
    },
    ws: {
      live: 'wss://stream.bybit.com/v5/public/linear',
      testnet: 'wss://stream-testnet.bybit.com/v5/public/linear',
    },
    privateWs: {
      live: 'wss://stream.bybit.com/v5/private',
      testnet: 'wss://stream-testnet.bybit.com/v5/private',
    },
  },
  okx: {
    rest: {
      live: 'https://www.okx.com',
      testnet: 'https://www.okx.com',
    },
    ws: {
      live: 'wss://ws.okx.com:8443/ws/v5/public',
      testnet: 'wss://wspap.okx.com:8443/ws/v5/public',
    },
    privateWs: {
      live: 'wss://ws.okx.com:8443/ws/v5/private',
      testnet: 'wss://wspap.okx.com:8443/ws/v5/private',
    },
  },
} as const;
