# Multi-Exchange Futures Trading Bot

> A production-style TypeScript futures trading bot supporting Binance USD-M, Bybit Linear, and OKX Swap markets with exchange-agnostic architecture, Kelly position sizing, and institutional-grade risk management.

<p align="center">

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](#)
[![Binance](https://img.shields.io/badge/Binance-USD--M-F3BA2F.svg)](#)
[![Bybit](https://img.shields.io/badge/Bybit-Linear-black.svg)](#)
[![OKX](https://img.shields.io/badge/OKX-Swap-white.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-orange.svg)](#)

</p>

---

## Why Open Source?

This repository is **not a commercial trading bot**.

It exists for one reason:

> **To share a real multi-exchange trading system instead of publishing endless trading theories without showing production-quality implementation.**

There are countless tutorials explaining indicators.

Thousands of videos promise profitable strategies.

Very few repositories demonstrate how professional trading software is actually engineered.

This project focuses on building reliable trading infrastructure—from market data ingestion to execution, risk management, and exchange abstraction.

---

## A Few Honest Notes

This bot **will not make you rich overnight.**

Markets evolve.

Liquidity changes.

Funding changes.

Strategies decay.

Execution latency matters.

No strategy remains profitable forever.

I don't hide these realities.

Instead, this repository demonstrates how an automated trading engine should be architected: modular, exchange-agnostic, observable, extensible, and built around risk management rather than unrealistic profit expectations.

Think of it as a foundation for your own quantitative trading research.

---

## Trading is Mathematics

This project uses **STAKE-MATH**, a Node.js library implementing Kelly-based position sizing.

Trading is not prediction.

Trading is probability management.

Every position should be backed by mathematics instead of emotion.

This project incorporates:

* Kelly Criterion
* Fractional Kelly
* Expected Value (EV)
* Risk-to-Reward optimization
* Dynamic leverage control
* Bankroll management
* Position sizing based on statistical edge

Over the long term, proper risk management contributes far more to survival than simply finding another trading indicator.

---

## My Recommendation

If you're building automated trading systems:

* start with paper trading
* verify every signal manually
* validate execution under different market conditions
* backtest before deploying live capital
* increase position size gradually
* never trade with money you cannot afford to lose

Longevity is far more valuable than short-term gains.

Happy Trading ❤️

---

# Features

* ⚡ Multi-exchange architecture
* 📈 Momentum breakout strategy
* 💰 Kelly Criterion position sizing
* 🛡 Advanced risk management
* 🔄 Exchange-agnostic execution engine
* 📊 Funding rate awareness
* 📉 Stop-loss & take-profit lifecycle
* 🚨 Daily loss kill switch
* 🔒 API failure circuit breaker
* 📝 Structured logging
* 🚀 Production-ready TypeScript codebase

---

# Supported Exchanges

| Exchange   | Market           |
| ---------- | ---------------- |
| 🟡 Binance | USD-M Futures    |
| ⚫ Bybit    | Linear Perpetual |
| ⚪ OKX      | USDT Swap        |

Switch exchanges simply by changing:

```bash
EXCHANGE=binance
```

or

```bash
EXCHANGE=bybit
```

or

```bash
EXCHANGE=okx
```

No strategy code needs to change.

---

# Strategy

The trading engine follows a modular pipeline.

```text
Market Data
      │
      ▼
Momentum Strategy
      │
      ▼
Funding Bias Filter
      │
      ▼
Kelly Position Sizing
      │
      ▼
Risk Validation
      │
      ▼
Execution Engine
      │
      ▼
Exchange Adapter
      │
      ▼
Portfolio & State Store
```

Each layer has a single responsibility, making the system easy to extend and maintain.

---

# Architecture

```text
               Market Data
                    │
                    ▼
               Strategy Engine
                    │
                    ▼
              Risk Management
                    │
                    ▼
             Execution Engine
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
    Binance      Bybit         OKX
        │           │            │
        └───────────┴────────────┘
                    │
                    ▼
               State Store
```

Every exchange implements the same normalized interface.

The strategy never communicates directly with exchange-specific APIs.

---

# Risk Management

The trading engine includes multiple independent safety systems.

* Kelly-based position sizing
* Maximum leverage limits
* Maximum position notional
* Daily loss kill switch
* Consecutive API error protection
* Per-symbol cooldown timers
* Minimum and maximum position sizing
* Funding-aware execution

The objective is to preserve capital first and pursue profits second.

---

# Kelly Position Sizing

Position sizing uses **STAKE-MATH**.

```typescript
import { computeFuturesKellyStake } from "./risk/position-sizing.js";

const stakeUsd = computeFuturesKellyStake({
  winProbability: 0.58,
  riskRewardRatio: 2,
  bankroll: 10000,
  maxStakeUsd: 500,
  minStakeUsd: 10,
  kellyFraction: 0.5
});
```

Inputs include:

* Win probability
* Risk/Reward ratio
* Current bankroll
* Fractional Kelly
* Minimum stake
* Maximum stake

Default configuration uses **Half Kelly (0.5)** to reduce volatility while maintaining long-term growth.

---

# Exchange Adapters

Every supported exchange is normalized behind a common interface.

| Exchange | REST         | WebSocket             | Notes                  |
| -------- | ------------ | --------------------- | ---------------------- |
| Binance  | `/fapi/v1/*` | `fstream.binance.com` | Hedge mode, reduceOnly |
| Bybit    | `/v5/*`      | V5 Public & Private   | Unified Account        |
| OKX      | `/api/v5/*`  | V5 Public & Private   | Demo & Production      |

Adapters return normalized objects including:

* Orders
* Positions
* Tickers
* Funding Rates
* Balances
* Fills

This allows strategies to remain completely exchange-independent.

---

# Project Structure

```text
src/

├── strategy/
│   └── Momentum breakout

├── market/
│   └── WebSocket market data

├── execution/
│   └── Order lifecycle

├── risk/
│   └── Kelly sizing & protection

├── exchange/
│   ├── Binance
│   ├── Bybit
│   └── OKX

├── state/
│   └── Portfolio & persistence

├── util/
│   └── Logging & helpers

└── index.ts
```

---

# Quick Start

```bash
cp .env.example .env

npm install

npm run paper
```

Paper trading is enabled by default.

Switch exchanges through:

```bash
EXCHANGE=binance
```

or

```bash
EXCHANGE=bybit
```

or

```bash
EXCHANGE=okx
```

---

# Available Scripts

| Command         | Description              |
| --------------- | ------------------------ |
| `npm run build` | Compile TypeScript       |
| `npm run dev`   | Run with tsx             |
| `npm run paper` | Paper trading            |
| `npm start`     | Run compiled application |

---

# Production Extensions

The architecture is designed for future scalability.

Recommended additions include:

* Redis for distributed state
* PostgreSQL for trade history
* Kafka or RabbitMQ for asynchronous execution
* Metrics collection
* Prometheus + Grafana monitoring
* Multi-process execution
* Distributed strategy workers

---

# Deployment Roadmap

Recommended deployment process:

* Run Binance Testnet with paper trading
* Verify market data integrity
* Validate execution flow
* Tune Kelly fraction and leverage
* Monitor long-term paper performance
* Enable live API keys
* Expand to Bybit and OKX

---

# Roadmap

* [ ] Additional exchanges
* [ ] Strategy plugin system
* [ ] Portfolio optimization
* [ ] Historical backtesting
* [ ] Walk-forward optimization
* [ ] Machine learning signals
* [ ] Web dashboard
* [ ] Telegram & Discord alerts

---

# Contributing

Contributions are welcome.

Whether you're interested in:

* quantitative trading
* exchange integrations
* TypeScript
* distributed systems
* software architecture
* performance optimization

feel free to open an Issue or Pull Request.

---

# Disclaimer

This repository is provided **for educational purposes only**.

Nothing contained here should be interpreted as financial advice.

Futures trading carries substantial financial risk and the potential for significant losses.

Always validate strategies through extensive backtesting and paper trading before deploying real capital.

Never risk funds you cannot afford to lose.

---

<p align="center">

### Built with ❤️ for quantitative traders and TypeScript developers.

If this repository helped you learn something new, consider giving it a ⭐.

</p>
