import type { BotConfig, ExchangeCredentials, ExchangeId } from '../core/types.js';
import type { EventBus } from '../core/events.js';
import { createBinanceAdapter } from './binance/adapter.js';
import { createBybitAdapter } from './bybit/adapter.js';
import { createOkxAdapter } from './okx/adapter.js';
import type { ExchangeAdapter } from './types.js';

export function createExchangeAdapter(
  exchange: ExchangeId,
  credentials: ExchangeCredentials,
  config: Pick<BotConfig, 'paperTrading' | 'testnet'>,
  events: EventBus,
): ExchangeAdapter {
  switch (exchange) {
    case 'binance':
      return createBinanceAdapter(credentials, config.testnet, config.paperTrading, events);
    case 'bybit':
      return createBybitAdapter(credentials, config.testnet, config.paperTrading, events);
    case 'okx':
      return createOkxAdapter(credentials, config.testnet, config.paperTrading, events);
    default:
      throw new Error(`Unsupported exchange: ${exchange}`);
  }
}

export { createBinanceAdapter } from './binance/adapter.js';
export { createBybitAdapter } from './bybit/adapter.js';
export { createOkxAdapter } from './okx/adapter.js';
export type { ExchangeAdapter } from './types.js';
