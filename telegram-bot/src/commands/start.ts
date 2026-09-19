import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { getOrCreateUser, getSubscriptionStatus, registerIp, detectIp } from '../services/api.js';

function formatTimeSpan(ts: { hours?: number; minutes?: number; seconds?: number } | string): string {
  if (typeof ts === 'string') {
    // Parse ISO duration like "PT23H59M59S"
    const match = ts.match(/PT?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return ts;
    const h = parseInt(match[1] || '0');
    const m = parseInt(match[2] || '0');
    const s = parseInt(match[3] || '0');
    if (h > 0) return `${h} ساعت و ${m} دقیقه`;
    if (m > 0) return `${m} دقیقه و ${s} ثانیه`;
    return `${s} ثانیه`;
  }
  // Object with hours/minutes/seconds
  const h = ts.hours || 0;
  const m = ts.minutes || 0;
  const s = ts.seconds || 0;
  if (h > 0) return `${h} ساعت و ${m} دقیقه`;
  if (m > 0) return `${m} دقیقه و ${s} ثانیه`;
  return `${s} ثانیه`;
}

export async function startHandler(ctx: Context) {
  const telegramId = ctx.from?.id;
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;

  if (!telegramId) {
    await ctx.reply('❌ خطا: شناسه کاربر یافت نشد');
    return;
  }

  // Create user and provision trial
  const result = await getOrCreateUser(telegramId, username, firstName, true);

  if (result.trialProvisioned && result.trial) {
    const remaining = formatTimeSpan(result.trial.remainingTime);
    await ctx.reply(
      `🎮 *DNS Manager Bot*\n\n` +
      `سلام ${firstName || 'کاربر'}! 👋\n\n` +
      `✅ اشتراک آزمایشی ۲۴ ساعته شما فعال شد.\n` +
      `⏳ زمان باقی‌مانده: *${remaining}*\n\n` +
      `لطفاً آی‌پی اینترنت خود را ثبت کنید تا سرویس فعال شود.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp('🌐 ثبت خودکار آی‌پی اینترنت', `${process.env.API_URL || 'http://backend-api:8080'}/api/ip/detect`)] as any,
          [Markup.button.callback('✏️ ثبت دستی آی‌پی', 'manual_ip')],
          [Markup.button.callback('📊 وضعیت اشتراک', 'subscription_status')],
          [Markup.button.callback('⚙️ راهنمای تنظیم DNS', 'dns_guide')],
        ]),
      }
    );
    return;
  }

  // User already exists, check subscription status
  const status = await getSubscriptionStatus(telegramId);

  let message: string;
  if (status.hasActiveSubscription && status.currentSubscription) {
    const sub = status.currentSubscription;
    const remaining = formatTimeSpan(sub.remainingTime);
    message =
      `🎮 *DNS Manager Bot*\n\n` +
      `سلام ${firstName || 'کاربر'}! 👋\n\n` +
      `✅ اشتراک شما فعال است.\n` +
      `📋 نوع: *${sub.type === 'Trial24H' ? 'آزمایشی ۲۴ ساعته' : sub.type}*\n` +
      `⏳ زمان باقی‌مانده: *${remaining}*\n` +
      (sub.registeredIp ? `🔗 آی‌پی ثبت‌شده: \`${sub.registeredIp}\`\n\n` : '\n') +
      `از منوی زیر انتخاب کنید:`;
  } else {
    message =
      `🎮 *DNS Manager Bot*\n\n` +
      `سلام ${firstName || 'کاربر'}! 👋\n\n` +
      `❌ شما اشتراک فعالی ندارید.\n` +
      `برای خرید اشتراک یا استفاده از دوره آزمایشی با مدیریت تماس بگیرید.\n\n` +
      `از منوی زیر انتخاب کنید:`;
  }

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.webApp('🌐 ثبت خودکار آی‌پی اینترنت', `${process.env.API_URL || 'http://backend-api:8080'}/api/ip/detect`)] as any,
      [Markup.button.callback('✏️ ثبت دستی آی‌پی', 'manual_ip')],
      [Markup.button.callback('📊 وضعیت اشتراک و زمان باقی‌مانده', 'subscription_status')],
      [Markup.button.callback('⚙️ راهنمای تنظیم DNS', 'dns_guide')],
      ...(status.hasActiveSubscription ? [] : [[Markup.button.callback('💳 خرید اشتراک', 'buy_subscription')]] as any),
    ]),
  });
}

export async function helpHandler(ctx: Context) {
  await startHandler(ctx);
}

// Handle callback queries
export async function setupCallbacks(bot: any) {
  bot.action('manual_ip', async (ctx: any) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '✏️ *ثبت دستی آی‌پی*\n\n' +
      'لطفاً آی‌پی IPv4 اینترنت خود را ارسال کنید.\n' +
      'مثال: `192.168.1.100`\n\n' +
      'برای دریافت آی‌پی فعلی خود می‌توانید از دستور زیر استفاده کنید:\n' +
      '`curl ifconfig.me`',
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('subscription_status', async (ctx: any) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const status = await getSubscriptionStatus(telegramId);
    if (!status.hasActiveSubscription || !status.currentSubscription) {
      await ctx.reply('❌ شما اشتراک فعالی ندارید.');
      return;
    }

    const sub = status.currentSubscription;
    const remaining = formatTimeSpan(sub.remainingTime);
    await ctx.reply(
      `📊 *وضعیت اشتراک*\n\n` +
      `📋 نوع: *${sub.type === 'Trial24H' ? 'آزمایشی ۲۴ ساعته' : sub.type}*\n` +
      `📅 شروع: ${new Date(sub.startDate).toLocaleDateString('fa-IR')}\n` +
      `📅 پایان: ${new Date(sub.endDate).toLocaleDateString('fa-IR')}\n` +
      `⏳ زمان باقی‌مانده: *${remaining}*\n` +
      (sub.registeredIp ? `🔗 آی‌پی ثبت‌شده: \`${sub.registeredIp}\`` : '🔗 هیچ آی‌پی ثبت نشده است'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('dns_guide', async (ctx: any) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '⚙️ *راهنمای تنظیم DNS*\n\n' +
      'برای استفاده از سرویس، DNS سرور خود را به آدرس زیر تغییر دهید:\n\n' +
      '`37.32.28.44`\n\n' +
      '*آموزش تنظیم در سیستم‌عامل‌های مختلف:*\n\n' +
      '1️⃣ *ویندوز:*\n' +
      '   - تنظیمات شبکه ← اینترنت → تغییر تنظیمات آداپتور\n' +
      '   - روی اتصال خود کلیک راست → Properties\n' +
      '   - Internet Protocol Version 4 (TCP/IPv4) → Properties\n' +
      '   - Use the following DNS server addresses\n' +
      '   - DNS: `37.32.28.44`\n\n' +
      '2️⃣ *اندروید:*\n' +
      '   - Settings → Wi-Fi → شبکه فعلی\n' +
      '   - Modify network → Advanced → IP settings → Static\n' +
      '   - DNS: `37.32.28.44`\n\n' +
      '3️⃣ *iOS:*\n' +
      '   - Settings → Wi-Fi → شبکه فعلی\n' +
      '   - Configure DNS → Manual\n' +
      '   - DNS: `37.32.28.44`\n\n' +
      '4️⃣ *لینوکس / مک:*\n' +
      '   - تنظیمات شبکه → DNS\n' +
      '   - افزودن `37.32.28.44`',
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('buy_subscription', async (ctx: any) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '💳 *خرید اشتراک*\n\n' +
      'برای خرید اشتراک با مدیریت تماس بگیرید:\n' +
      '@admin_username\n\n' +
      'پلن‌های موجود:\n' +
      '• ماهانه: ۱۰۰,۰۰۰ تومان\n' +
      '• سه ماهه: ۲۵۰,۰۰۰ تومان\n' +
      '• سالانه: ۸۰۰,۰۰۰ تومان',
      { parse_mode: 'Markdown' }
    );
  });

  // Handle manual IP text input
  bot.on('text', async (ctx: any, next: any) => {
    // Skip commands
    if (ctx.message?.text?.startsWith('/')) {
      return next();
    }

    const telegramId = ctx.from?.id;
    const text = ctx.message?.text?.trim();

    if (!telegramId || !text) return next();

    // Check if it looks like an IPv4 address (basic check)
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (ipv4Regex.test(text)) {
      try {
        const result = await registerIp(telegramId, text);
        if (result.success) {
          await ctx.reply(
            `✅ *آی‌پی با موفقیت ثبت شد!*\n\n` +
            `🔗 آی‌پی ثبت‌شده: \`${result.registeredIp}\`\n\n` +
            `سرویس DNS برای شما فعال شد.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply(`❌ خطا: ${result.message}`);
        }
      } catch (err: any) {
        const msg = err?.response?.data?.message || 'خطا در ارتباط با سرور';
        await ctx.reply(`❌ ${msg}`);
      }
      return;
    }

    return next();
  });
}