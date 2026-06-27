# Multi-Exchange Futures Trading Bot

TypeScript futures bot for **Binance USD-M**, **Bybit linear**, and **OKX swap** markets. Strategy logic is exchange-agnostic; each venue is wrapped behind a normalized adapter.

## Architecture

```
Market Data ──► Strategy ──► Risk ──► Execution ──► Exchange Adapter
     │              │         │          │
     └──────────────┴─────────┴──────────┴──► State Store
```

| Layer | Responsibility |
|-------|----------------|
| **Market data** | WebSocket tickers, order books, funding, fills |
| **Strategy** | Momentum breakout + funding bias → normalized signals |
| **Risk** | Kelly sizing (`stake-math`), leverage cap, daily loss kill switch, cooldowns |
| **Execution** | Entry + stop-loss + take-profit order lifecycle |
| **State store** | Positions, PnL, signals, kill-switch (extend with Redis/PostgreSQL) |

## Quick start

```bash
cp .env.example .env
npm install
npm run paper   # paper + testnet (default)
```

Switch exchange via `EXCHANGE=binance|bybit|okx` in `.env`.

## Kelly position sizing (`stake-math`)

Risk sizing uses [`stake-math`](https://www.npmjs.com/package/stake-math) (pinned to `3.1.0`; npm has no `3.0.0` release). The adapter in `src/risk/position-sizing.ts` maps futures reward-to-risk into stake-math’s binary-market inputs:

```typescript
import { computeFuturesKellyStake } from './risk/position-sizing.js';

const stakeUsd = computeFuturesKellyStake({
  winProbability: 0.58,
  riskRewardRatio: 2,
  bankroll: 10_000,
  maxStakeUsd: 500,
  minStakeUsd: 10,
  kellyFraction: 0.5, // half-Kelly
});
```

> **Security note:** Public research has flagged similarly named npm packages (`polymarket-stake-math`) as malicious. This project pins the `stake-math` package by exact version. Review the package source on npm before installing in production.

## Exchange adapters

| Exchange | REST | WebSocket | Notes |
|----------|------|-----------|-------|
| Binance | `/fapi/v1/*` | `fstream.binance.com` | `reduceOnly`, hedge `positionSide` |
| Bybit | `/v5/*` | v5 public/private linear | Unified account, strict position mode |
| OKX | `/api/v5/*` | v5 public/private | `BTC-USDT-SWAP` instId, demo via `x-simulated-trading` |

All adapters implement `ExchangeAdapter` and return normalized `NormalizedOrder`, `Position`, `Ticker`, etc.

## Risk controls

- Max leverage (default 5×, below exchange max)
- Max position notional
- Daily loss kill switch
- Consecutive API error kill switch
- Per-symbol cooldown
- Half-Kelly stake sizing with min/max bounds

## Production extensions

- **Redis** — distributed locks, live state cache
- **PostgreSQL** — trades, signals, audit log (see `StatePersistence` in `src/state/store.ts`)
- **Kafka/RabbitMQ** — async signal → execution pipeline

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run with tsx |
| `npm run paper` | Paper trading mode |
| `npm start` | Run compiled `dist/index.js` |

## Build order (recommended)

1. Binance USD-M on testnet with `PAPER_TRADING=true`
2. Validate WebSocket feeds and order lifecycle
3. Tune risk limits and Kelly fraction
4. Enable live keys only after sustained paper results
5. Add Bybit / OKX by changing `EXCHANGE`

## Disclaimer

This software is for educational purposes. Futures trading carries substantial risk of loss. Test thoroughly on testnet/paper before using real funds.
