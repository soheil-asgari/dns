import 'dotenv/config';
import { Telegraf, session } from 'telegraf';
import RedisSession from 'telegraf-session-redis';
import pino from 'pino';
import { startHandler, helpHandler, setupCallbacks } from './commands/start.js';
import { dnsHandler } from './commands/dns.js';
import { listHandler } from './commands/list.js';
import { adminHandler } from './commands/admin.js';
import { fetchBotToken } from './services/api.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let bot: Telegraf | null = null;
let running = false;

async function getBotToken(): Promise<string | null> {
  // First try environment variable
  let token = process.env.BOT_TOKEN;
  if (token && token !== 'your_telegram_bot_token_here' && token !== '') {
    return token;
  }

  // Fall back to backend API
  try {
    logger.info('BOT_TOKEN not in env, fetching from backend API...');
    const result = await fetchBotToken();
    if (result?.token) {
      token = result.token;
      logger.info('Bot token retrieved from backend API');
      return token;
    }
  } catch (err) {
    logger.error({ err }, 'Failed to fetch bot token from backend API');
  }

  return null;
}

async function startBot(token: string) {
  if (running && bot) {
    logger.info('Bot already running, restarting with new token...');
    bot.stop('restart');
    running = false;
  }

  bot = new Telegraf(token);

  // Session middleware with Redis
  const redisUrl = new URL(process.env.REDIS_URL || 'redis://redis:6379');
  const sessionStore = new RedisSession({
    store: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
      ...(redisUrl.password ? { password: redisUrl.password } : {}),
    },
    ttl: 86400,
  });

  bot.use(sessionStore.middleware());
  bot.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logger.info({ updateId: ctx.update.update_id, ms }, 'processed update');
  });

  // Commands
  bot.start(startHandler);
  bot.help(helpHandler);
  bot.command('dns', dnsHandler);
  bot.command('list', listHandler);
  bot.command('admin', adminHandler);

  // Setup callback query handlers (subscription flow)
  setupCallbacks(bot);

  // Start bot
  bot.launch(() => {
    logger.info('Bot started');
    running = true;
  });

  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
}

async function init() {
  const token = await getBotToken();

  if (!token) {
    logger.warn('No bot token available. Bot will wait and retry periodically...');
    // Retry fetching token every 30 seconds until available
    const retryInterval = setInterval(async () => {
      const newToken = await getBotToken();
      if (newToken) {
        clearInterval(retryInterval);
        logger.info('Token obtained after retry, starting bot...');
        await startBot(newToken);
      }
    }, 30_000);
  } else {
    await startBot(token);
  }

  // Subscribe to Redis for dynamic token updates
  try {
    const { createClient } = await import('redis');
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
    const subscriber = createClient({ url: redisUrl });
    await subscriber.connect();
    await subscriber.subscribe('config:bot_token_changed', async (newToken) => {
      logger.info('Bot token changed via Redis pub/sub, restarting...');
      await startBot(newToken);
    });
  } catch (err) {
    logger.warn({ err }, 'Redis pub/sub subscription failed (non-critical)');
  }
}

// Health endpoint for HAProxy
import http from 'http';
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(running ? 'OK' : 'Bot idle');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(5000, () => {
  logger.info('Health server listening on port 5000');
});

init();