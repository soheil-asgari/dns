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

const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

function isTokenFormatValid(token: string): boolean {
  return typeof token === 'string' && BOT_TOKEN_PATTERN.test(token);
}

async function startBot(token: string) {
  if (!isTokenFormatValid(token)) {
    logger.warn({ token: token ? `${token.slice(0, 5)}...` : '(empty)' }, 'Invalid bot token format, skipping launch');
    return;
  }

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

  // Start bot with graceful error handling for invalid tokens
  try {
    await bot.launch();
    logger.info('Bot started');
    running = true;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('404') || errMsg.includes('Not Found') || errMsg.includes('not found')) {
      logger.warn(
        'Provided bot token is invalid or not found on Telegram servers. Waiting for a valid token via Settings or Redis...'
      );
    } else {
      logger.error({ err: errMsg }, 'Failed to launch bot');
    }
    bot = null;
    running = false;
  }
}

function setupProcessHandlers(botInstance: Telegraf | null) {
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.once('SIGINT', () => botInstance?.stop('SIGINT'));
  process.once('SIGTERM', () => botInstance?.stop('SIGTERM'));
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
        setupProcessHandlers(bot);
      }
    }, 30_000);
  } else {
    await startBot(token);
    setupProcessHandlers(bot);
  }

  // Subscribe to Redis for dynamic token updates
  try {
    const { createClient } = await import('redis');
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
    const subscriber: any = createClient({ url: redisUrl });
    // redis v2 connects automatically; no .connect() call needed (avoids "subscriber.connect is not a function")
    await subscriber.subscribe('config:bot_token_changed', (message: string) => {
      if (!message) return;
      if (!isTokenFormatValid(message)) {
        logger.warn({ payload: message.slice(0, 5) + '...' }, 'Received invalid bot token via Redis pub/sub, ignoring');
        return;
      }
      logger.info('Bot token changed via Redis pub/sub, restarting...');
      startBot(message).then(() => setupProcessHandlers(bot));
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: errMsg }, 'Redis pub/sub subscription failed (non-critical)');
  }

  // Subscribe to payment notifications
  try {
    const { createClient } = await import('redis');
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
    const paymentSub: any = createClient({ url: redisUrl });
    await paymentSub.subscribe('payment:notify', async (message: string) => {
      if (!message || !bot) return;
      try {
        const payload = JSON.parse(message);
        if (payload.type === 'payment_success' && payload.telegramId) {
          const endDate = new Date(payload.endDate).toLocaleDateString('fa-IR') + ' ' + new Date(payload.endDate).toLocaleTimeString('fa-IR');
          await bot.telegram.sendMessage(
            payload.telegramId,
            `✅ *پرداخت شما با موفقیت انجام شد!*\n\n` +
            `🧾 کد پیگیری: \`${payload.refId}\`\n` +
            `📦 پلن: ${payload.planTitle}\n` +
            `💰 مبلغ: ${payload.amount.toLocaleString('fa-IR')} تومان\n` +
            `📅 اشتراک شما تا تاریخ *${endDate}* تمدید گردید.\n\n` +
            `⚡️ لطفاً آی‌پی اینترنت خود را مجدداً ثبت کنید.`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (e) {
        logger.warn({ err: e }, 'Failed to process payment notification');
      }
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: errMsg }, 'Payment notification subscriber failed (non-critical)');
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