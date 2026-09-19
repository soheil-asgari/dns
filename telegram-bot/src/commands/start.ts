import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { getOrCreateUser, getSubscriptionStatus, registerIp, detectIp, buildQuickRegisterUrl, getPlans, applyDiscount, checkout } from '../services/api.js';

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

// Persistent reply keyboard markup
const mainKeyboard = Markup.keyboard([
  ['🔍 وضعیت و آی‌پی من', '⚡️ ثبت آی‌پی من'],
  ['💳 خرید و تمدید اشتراک', '📖 راهنمای تنظیم DNS'],
]).resize().persistent();

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
      `برای فعال‌سازی و اتصال به سرور، لطفاً آی‌پی عمومی اینترنت خود را به صورت پیام متنی ارسال کنید (مثال: \`1.2.3.4\`).`,
      {
        parse_mode: 'Markdown',
        ...mainKeyboard,
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
    ...mainKeyboard,
  });
}

export async function helpHandler(ctx: Context) {
  await startHandler(ctx);
}

// Handle persistent keyboard text commands
async function handlePersistentKeyboard(ctx: Context, text: string, telegramId: number) {
  switch (text) {
    case '🔍 وضعیت و آی‌پی من': {
      try {
        const status = await getSubscriptionStatus(telegramId);
        if (!status.hasActiveSubscription || !status.currentSubscription) {
          await ctx.reply('❌ شما اشتراک فعالی ندارید.', { ...mainKeyboard });
          return;
        }
        const sub = status.currentSubscription;
        const remaining = formatTimeSpan(sub.remainingTime);
        await ctx.reply(
          `📊 *وضعیت و آی‌پی من*\n\n` +
          `📋 نوع اشتراک: *${sub.type === 'Trial24H' ? 'آزمایشی ۲۴ ساعته' : sub.type}*\n` +
          `📅 شروع: ${new Date(sub.startDate).toLocaleDateString('fa-IR')}\n` +
          `📅 پایان: ${new Date(sub.endDate).toLocaleDateString('fa-IR')}\n` +
          `⏳ زمان باقی‌مانده: *${remaining}*\n` +
          (sub.registeredIp
            ? `🔗 آی‌پی ثبت‌شده: \`${sub.registeredIp}\``
            : '🔗 هیچ آی‌پی ثبت نشده است') +
          `\n\n🌐 سرور DNS: \`37.32.28.44\``,
          { parse_mode: 'Markdown', ...mainKeyboard }
        );
      } catch {
        await ctx.reply('❌ خطا در دریافت اطلاعات. لطفاً دوباره تلاش کنید.', { ...mainKeyboard });
      }
      return true;
    }

    case '⚡️ ثبت آی‌پی من': {
      const quickRegisterUrl = buildQuickRegisterUrl(telegramId);
      await ctx.reply(
        `⚡️ *ثبت خودکار آی‌پی*\n\n` +
        `روی لینک زیر کلیک کنید تا آی‌پی شما به صورت آنی شناسایی و فعال شود:\n\n` +
        `👉 [ثبت و فعال‌سازی آی‌پی من](${quickRegisterUrl})\n\n` +
        `_همچنین می‌توانید آی‌پی اینترنت خود را به صورت دستی در چت بفرستید._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 ثبت و اتصال خودکار آی‌پی", url: quickRegisterUrl }]
            ]
          }
        }
      );
      return true;
    }

    case '💳 خرید و تمدید اشتراک': {
      try {
        const plans = await getPlans();
        if (!plans || plans.length === 0) {
          await ctx.reply('❌ هیچ پلن فعالی یافت نشد.', { ...mainKeyboard });
          return true;
        }

        if (plans.length === 1) {
          const plan = plans[0];
          await ctx.reply(
            `📦 *${plan.title}*\n` +
            `💰 مبلغ: *${plan.price.toLocaleString('fa-IR')}* تومان\n\n` +
            `آیا کد تخفیف دارید؟`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🎁 ثبت کد تخفیف', callback_data: `single_discount_${plan.id}` },
                    { text: '➡️ پرداخت بدون تخفیف', callback_data: `single_nodiscount_${plan.id}` },
                  ]
                ]
              }
            }
          );
        } else {
          const lines = plans.map((p, i) =>
            `${i + 1}. ${p.title} — ${p.price.toLocaleString('fa-IR')} تومان`
          );
          const inlineButtons = plans.map(p => [
            Markup.button.callback(`📦 ${p.title}`, `select_plan_${p.id}`)
          ]);

          await ctx.reply(
            '💳 *خرید و تمدید اشتراک*\n\n' +
            'پلن‌های موجود:\n' +
            lines.join('\n') + '\n\n' +
            'لطفاً پلن مورد نظر خود را انتخاب کنید:',
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: inlineButtons }
            }
          );
        }
      } catch {
        await ctx.reply('❌ خطا در دریافت پلن‌ها. لطفاً دوباره تلاش کنید.', { ...mainKeyboard });
      }
      return true;
    }

    case '📖 راهنمای تنظیم DNS': {
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
        { parse_mode: 'Markdown', ...mainKeyboard }
      );
      return true;
    }

    default:
      return false;
  }
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
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
  });

  bot.action('subscription_status', async (ctx: any) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const status = await getSubscriptionStatus(telegramId);
    if (!status.hasActiveSubscription || !status.currentSubscription) {
      await ctx.reply('❌ شما اشتراک فعالی ندارید.', { ...mainKeyboard });
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
      { parse_mode: 'Markdown', ...mainKeyboard }
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
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
  });

  // Payment: select plan (multi-plan flow)
  bot.action(/^select_plan_/, async (ctx: any) => {
    await ctx.answerCbQuery();
    const planId = ctx.match[0].replace('select_plan_', '');
    const telegramId = ctx.from?.id;
    if (!telegramId || !planId) return;

    // Store planId in session
    ctx.session = ctx.session || {};
    ctx.session.selectedPlanId = planId;
    ctx.session.awaitingDiscount = true;

    await ctx.reply(
      '🎫 آیا کد تخفیف دارید؟\n\n' +
      'کد تخفیف خود را ارسال کنید، در غیر این صورت دکمه «بدون تخفیف» را بزنید.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚫 بدون تخفیف', callback_data: 'no_discount' }]
          ]
        }
      }
    );
  });

  // Payment: single-plan with discount
  bot.action(/^single_discount_/, async (ctx: any) => {
    await ctx.answerCbQuery();
    const planId = ctx.match[0].replace('single_discount_', '');
    const telegramId = ctx.from?.id;
    if (!telegramId || !planId) return;

    ctx.session = ctx.session || {};
    ctx.session.selectedPlanId = planId;
    ctx.session.awaitingDiscount = true;

    await ctx.reply(
      '🎫 *ثبت کد تخفیف*\n\n' +
      'لطفاً کد تخفیف خود را ارسال کنید.',
      { parse_mode: 'Markdown' }
    );
  });

  // Payment: single-plan no discount (immediate checkout)
  bot.action(/^single_nodiscount_/, async (ctx: any) => {
    await ctx.answerCbQuery();
    const planId = ctx.match[0].replace('single_nodiscount_', '');
    const telegramId = ctx.from?.id;
    if (!telegramId || !planId) return;

    ctx.session = ctx.session || {};
    await proceedToCheckout(ctx, planId, undefined);
  });

  // Payment: no discount
  bot.action('no_discount', async (ctx: any) => {
    await ctx.answerCbQuery();
    ctx.session = ctx.session || {};
    ctx.session.awaitingDiscount = false;
    await proceedToCheckout(ctx, ctx.session.selectedPlanId, undefined);
  });

  // Handle discount code text input (after plan selection)
  // This is handled in the text handler below.

  async function proceedToCheckout(ctx: any, planId: string, discountCode?: string) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      let finalAmount: number;
      let planTitle = '';

      if (discountCode) {
        const discountResult = await applyDiscount(discountCode, planId);
        finalAmount = discountResult.discountedPrice;
        planTitle = ''; // We'll get it from checkout response
      }

      const checkoutResult = await checkout(telegramId, planId, discountCode);

      await ctx.reply(
        '🏷 *پلن انتخابی:* ' + checkoutResult.amount.toLocaleString('fa-IR') + ' تومان\n' +
        '💰 *مبلغ نهایی:* ' + checkoutResult.amount.toLocaleString('fa-IR') + ' تومان\n\n' +
        'جهت تکمیل خرید روی لینک زیر کلیک کنید:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔗 ورود به درگاه پرداخت زرین‌پال (شاپرک)', url: checkoutResult.paymentUrl }]
            ]
          }
        }
      );

      // Reset session
      ctx.session.selectedPlanId = null;
      ctx.session.awaitingDiscount = false;
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'خطا در ایجاد تراکنش';
      await ctx.reply('❌ ' + msg, { ...mainKeyboard });
    }
  }

  // Handle discount code input (after plan selection)
  bot.on('text', async (ctx: any, next: any) => {
    // Skip commands
    if (ctx.message?.text?.startsWith('/')) {
      return next();
    }

    const telegramId = ctx.from?.id;
    const text = ctx.message?.text?.trim();

    if (!telegramId || !text) return next();

    // Check if awaiting discount code
    ctx.session = ctx.session || {};
    if (ctx.session.awaitingDiscount && ctx.session.selectedPlanId) {
      ctx.session.awaitingDiscount = false;
      await proceedToCheckout(ctx, ctx.session.selectedPlanId, text);
      return;
    }

    // Check if it matches a persistent keyboard command first
    const handled = await handlePersistentKeyboard(ctx, text, telegramId);
    if (handled) return;

    // Check if it looks like an IPv4 address (basic check)
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (ipv4Regex.test(text)) {
      try {
        const result = await registerIp(telegramId, text);
        if (result.success) {
          await ctx.reply(
            `✅ *آی‌پی ${result.registeredIp} با موفقیت در سیستم ثبت شد!*\n\n` +
            `⚠️ آی‌پی قبلی شما غیرفعال و آی‌پی جدید جایگزین شد.\n\n` +
            `از حالا می‌توانید با ست کردن DNS زیر، از اینترنت بدون تحریم استفاده کنید:\n` +
            `Primary DNS: \`37.32.28.44\``,
            { parse_mode: 'Markdown', ...mainKeyboard }
          );
        } else {
          await ctx.reply(`❌ خطا: ${result.message}`, { ...mainKeyboard });
        }
      } catch (err: any) {
        const msg = err?.response?.data?.message || 'خطا در ارتباط با سرور';
        await ctx.reply(`❌ ${msg}`, { ...mainKeyboard });
      }
      return;
    }

    return next();
  });
}