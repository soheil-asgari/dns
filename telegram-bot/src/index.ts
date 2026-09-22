import 'dotenv/config';
import { Telegraf, session } from 'telegraf';
import RedisSession from 'telegraf-session-redis';
import pino from 'pino';
import { startHandler, helpHandler, setupCallbacks } from './commands/start.js';
import { dnsHandler } from './commands/dns.js';
import { listHandler } from './commands/list.js';
import { adminHandler } from './commands/admin.js';
import { fetchBotToken } from './services/api.js';
import { publishLatestGamingNews, publishDnsPromo } from './modules/channelPublisher.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let bot: Telegraf | null = null;
let running = false;
let generalRedis: any = null; // کلاینت ردیس برای کارهای معمولی مثل بررسی خبرهای تکراری

async function getBotToken(): Promise<string | null> {
  let token = process.env.BOT_TOKEN;
  if (token && token !== 'your_telegram_bot_token_here' && token !== '') {
    return token;
  }

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

  // دستور تست دستی ارسال خبر به کانال
  bot.command('postnews', async (ctx) => {
    try {
      await ctx.reply('⏳ در حال دریافت آخرین اخبار گیمینگ و بازنویسی با مدل هوش مصنوعی...');
      await publishLatestGamingNews(bot!, generalRedis);
      await ctx.reply('✅ خبر جدید با موفقیت به کانال ارسال شد.');
    } catch (err: any) {
      logger.error({ err }, 'Failed to publish news via /postnews');
      await ctx.reply(`❌ خطا در پردازش یا ارسال: ${err?.message || err}`);
    }
  });
  bot.command('postdns', async (ctx) => {
    try {
      await ctx.reply('⏳ در حال تولید پست اختصاصی دی‌ان‌اس با هوش مصنوعی و ارسال به کانال...');
      await publishDnsPromo(bot!);
      await ctx.reply('✅ پست اختصاصی دی‌ان‌اس با موفقیت در کانال منتشر شد!');
    } catch (err: any) {
      logger.error({ err }, 'Failed to publish DNS promo via /postdns');
      await ctx.reply(`❌ خطا در ارسال پست دی‌ان‌اس: ${err?.message || err}`);
    }
  });

  // Setup callback query handlers
  setupCallbacks(bot);

  // Start bot
  try {
    await bot.launch();
    logger.info('Bot started');
    running = true;

    // ارسال خودکار اخبار به کانال (اجرای اول بعد از ۲ دقیقه، سپس هر ۳ ساعت یک‌بار)
    setTimeout(() => {
      if (bot && running) {
        publishLatestGamingNews(bot, generalRedis);
      }
    }, 2 * 60 * 1000);

    setInterval(() => {
      if (bot && running) {
        publishLatestGamingNews(bot, generalRedis);
      }
    }, 3 * 60 * 60 * 1000);

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('404') || errMsg.includes('Not Found') || errMsg.includes('not found')) {
      logger.warn('Provided bot token is invalid. Waiting for a valid token...');
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
  // ساخت کلاینت عمومی ردیس برای بررسی تکراری نبودن اخبار
  try {
    const redisModule: any = await import('redis');
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
    generalRedis = redisModule.createClient(redisUrl);
    generalRedis.on('error', (err: any) => {
      logger.warn({ err: err?.message || err }, 'General Redis client error');
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to create general Redis client');
  }

  const token = await getBotToken();

  if (!token) {
    logger.warn('No bot token available. Bot will wait and retry periodically...');
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
    const subscriber: any = createClient(redisUrl);
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

  // Subscribe to notifications (payment, ip registration, expiry reminder)
  try {
    const redisModule: any = await import('redis');
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
    const paymentSub: any = redisModule.createClient(redisUrl);

    paymentSub.on('error', (err: any) => {
      logger.warn({ err: err?.message || err }, 'Redis subscriber error');
    });

    paymentSub.on('message', async (channel: string, message: string) => {
      if (channel !== 'payment:notify' || !message || !bot) return;

      try {
        const payload = JSON.parse(message);
        const chatId = payload.telegramId;
        if (!chatId) return;

        await new Promise(r => setTimeout(r, 50));

        switch (payload.type) {
          case 'payment_success': {
            // Cascade fallback for plan title: payload.planTitle -> payload.planName -> payload.planDuration -> 'اشتراک ویژه'
            let planName = payload.planTitle || payload.planName || '';
            if (!planName && payload.planDurationDays) {
              planName = `${payload.planDurationDays} روزه`;
            }
            planName = planName || 'اشتراک ویژه';
            const refId = payload.refId || '—';
            const amount = (payload.amount || 0).toLocaleString('fa-IR');
            const endDate = new Date(payload.endDate);
            const expiryShamsi = endDate.toLocaleDateString('fa-IR') + ' ' + endDate.toLocaleTimeString('fa-IR');

            await bot.telegram.sendMessage(
              chatId,
              `✅ *پرداخت شما با موفقیت انجام شد*\n\n` +
              `📦 پلن خریداری‌شده: ${planName}\n` +
              `💳 شماره پیگیری: \`${refId}\`\n` +
              `💰 مبلغ: ${amount} تومان\n` +
              `📅 تاریخ پایان اشتراک: ${expiryShamsi}\n\n` +
              `⚠️ *توجه مهم:* برای فعال‌سازی ترافیک روی پورت ۴۴۳، حتماً آی‌پی دستگاه خود را ثبت کنید.\n` +
              `اکنون از طریق دکمه زیر اقدام کنید:`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🎮 ثبت آی‌پی دستگاه', callback_data: 'register_ip' }],
                    [{ text: '📖 راهنمای اتصال', callback_data: 'guide_connection' }],
                  ]
                }
              }
            );
            break;
          }

          case 'ip_registered': {
            const userIp = payload.ipAddress || '—';
            const remainingTime = payload.formattedTime || `${payload.remainingTime || 0} ساعت`;
            await bot.telegram.sendMessage(
              chatId,
              `✅ *آی‌پی اینترنت شما با موفقیت ثبت شد!*\n\n` +
              `🔗 *آی‌پی فعال:* \`${userIp}\`\n` +
              `⏳ *مدت اعتبار باقی‌مانده:* ${remainingTime}\n\n` +
              `━━━━━━━━━━━━━━━━━━━\n` +
              `🌐 *آدرس‌های DNS اختصاصی راینو:*\n` +
              `🔹 *Primary DNS:* \`185.226.119.97\`\n` +
              `🔸 *Secondary DNS:* \`185.226.117.62\`\n\n` +
              `⚠️ *نکته مهم:* در صورتی که مودم خود را خاموش و روشن کردید یا آی‌پی شما تغییر کرد، جهت جلوگیری از قطع شدن دسترسی به بازی‌ها مجدداً آی‌پی خود را ثبت کنید.`,
              { parse_mode: 'Markdown' }
            );
            break;
          }

          case 'expiry_reminder': {
            const expiryDate = new Date(payload.endDate);
            const expiryShamsi = expiryDate.toLocaleDateString('fa-IR') + ' ' + expiryDate.toLocaleTimeString('fa-IR');
            await bot.telegram.sendMessage(
              chatId,
              `⚠️ *یادآوری پایان اشتراک*\n\n` +
              `کاربر گرامی، تنها ۳ روز از اعتبار اشتراک سرویس گیمینگ شما باقی مانده است.\n` +
              `📅 تاریخ انقضا: ${expiryShamsi}\n\n` +
              `برای جلوگیری از قطعی سرویس در هنگام بازی، اشتراک خود را تمدید فرمایید.`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '💳 تمدید اشتراک', callback_data: 'renew_subscription' }],
                  ]
                }
              }
            );
            break;
          }

          default:
            logger.warn({ type: payload.type }, 'Unknown notification type, ignoring');
        }
      } catch (e) {
        logger.warn({ err: e }, 'Failed to process notification');
      }
    });

    paymentSub.subscribe('payment:notify');
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: errMsg }, 'Notification subscriber failed (non-critical)');
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