import { loadConfig, loadCredentials } from './config/index.js';
import { EventBus } from './core/events.js';
import type { BotConfig } from './core/types.js';
import { ExecutionService } from './execution/service.js';
import { createExchangeAdapter } from './exchanges/index.js';
import { MarketDataService } from './market/service.js';
import { RiskService } from './risk/service.js';
import { StateStore } from './state/store.js';
import { StrategyService } from './strategy/service.js';

export class TradingBot {
  private readonly events = new EventBus();
  private readonly store = new StateStore();
  private readonly config: BotConfig;
  private readonly adapter;
  private readonly market: MarketDataService;
  private readonly strategy: StrategyService;
  private readonly risk: RiskService;
  private readonly execution: ExecutionService;
  private accountRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(configOverrides: Partial<BotConfig> = {}) {
    this.config = loadConfig(configOverrides);
    const credentials = loadCredentials(this.config.exchange);

    this.adapter = createExchangeAdapter(
      this.config.exchange,
      credentials,
      this.config,
      this.events,
    );

    this.market = new MarketDataService(this.adapter, this.store, this.events);
    this.strategy = new StrategyService(this.config, this.store, this.events);
    this.risk = new RiskService(this.config, this.store);
    this.execution = new ExecutionService(
      this.config,
      this.adapter,
      this.risk,
      this.store,
      this.events,
    );

    this.events.on('kill_switch', ({ reason }) => {
      console.error(`[KILL SWITCH] ${reason}`);
    });
    this.events.on('error', ({ source, message }) => {
      console.error(`[${source}] ${message}`);
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const mode = this.config.paperTrading ? 'PAPER' : 'LIVE';
    const net = this.config.testnet ? 'testnet' : 'mainnet';
    console.log(
      `Starting ${this.config.exchange} futures bot [${mode}/${net}] symbols=${this.config.symbols.join(',')}`,
    );

    await this.market.start(this.config.symbols);

    this.accountRefreshTimer = setInterval(() => {
      this.market.refreshAccountState(this.config.symbols).catch((err) => {
        this.store.recordApiError();
        console.error('Account refresh failed:', err);
      });
    }, 30_000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.accountRefreshTimer) clearInterval(this.accountRefreshTimer);
    await this.market.stop();
    console.log('Bot stopped.');
  }

  getState() {
    return this.store.getSnapshot();
  }

  getConfig() {
    return this.config;
  }
}
