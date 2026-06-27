import { TradingBot } from './bot.js';

async function main(): Promise<void> {
  const paperTrading = process.argv.includes('--live')
    ? false
    : process.argv.includes('--paper') || process.env.PAPER_TRADING !== 'false';

  const bot = new TradingBot({ paperTrading });

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await bot.start();

  // Keep process alive; strategy reacts to WebSocket ticker events
  setInterval(() => {
    const state = bot.getState();
    if (state.killSwitchActive) {
      console.warn(`Kill switch: ${state.killSwitchReason}`);
    }
  }, 60_000);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
