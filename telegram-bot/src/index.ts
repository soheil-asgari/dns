import 'dotenv/config';
import { Telegraf, session } from 'telegraf';
import RedisSession from 'telegraf-session-redis';
import pino from 'pino';
import { startHandler, helpHandler } from './commands/start.js';
import { dnsHandler } from './commands/dns.js';
import { listHandler } from './commands/list.js';
import { adminHandler } from './commands/admin.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const bot = new Telegraf(process.env.BOT_TOKEN!);

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

// Health endpoint for HAProxy
import http from 'http';
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(5000, () => {
  logger.info('Health server listening on port 5000');
});

// Start bot
bot.launch(() => {
  logger.info('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));