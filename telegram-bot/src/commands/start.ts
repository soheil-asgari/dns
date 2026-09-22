import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { getOrCreateUser, getSubscriptionStatus, registerIp, detectIp, buildQuickRegisterUrl, getPlans, applyDiscount, checkout } from '../services/api.js';
import { formatRemainingTime, formatPlanType, resolvePlanTitle } from '../utils/formatters.js';

// Persistent reply keyboard markup — overhauled with "My Plan & DNS" button
const mainKeyboard = Markup.keyboard([
  ['🎮 پلن و دی‌ان‌اس من', '⚡️ ثبت آی‌پی من'],
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

  // Create / get user silently (no raw status dump)
  await getOrCreateUser(telegramId, username, firstName, true);

  // Clean, welcoming intro — no raw subscription dumps
  await ctx.reply(
    `🎮 *به راینو دی‌ان‌اس خوش آمدید!* 👋\n\n` +
    `سرویس ضدتحریم اختصاصی برای گیمرهای حرفه‌ای:\n` +
    `🎯 Warzone | Valorant | Apex Legends | Battle.net\n` +
    `🎯 Steam | Discord | FC 25 و هر بازی آنلاین دیگر\n\n` +
    `✅ بدون پکت‌لاست\n` +
    `✅ پینگ پایدار روی سرورهای اروپا\n` +
    `✅ ثبت آی‌پی در ۱ کلیک\n\n` +
    `از منوی زیر گزینه مورد نظر را انتخاب کنید 👇`,
    {
      parse_mode: 'Markdown',
      ...mainKeyboard,
    }
  );
}

export async function helpHandler(ctx: Context) {
  await startHandler(ctx);
}

// Handle persistent keyboard text commands
async function handlePersistentKeyboard(ctx: Context, text: string, telegramId: number) {
  switch (text) {
    case '🎮 پلن و دی‌ان‌اس من': {
      try {
        const status = await getSubscriptionStatus(telegramId);
        if (!status.hasActiveSubscription || !status.currentSubscription) {
          await ctx.reply(
            '🎮 *پلن و دی‌ان‌اس من*\n\n' +
            '❌ شما اشتراک فعالی ندارید.\n\n' +
            'برای شروع می‌توانید از تست رایگان ۲۴ ساعته استفاده کنید یا یکی از پلن‌های ویژه را خریداری کنید.\n' +
            'از منوی «💳 خرید و تمدید اشتراک» اقدام کنید.',
            { parse_mode: 'Markdown', ...mainKeyboard }
          );
          return;
        }

        const sub = status.currentSubscription;
        const remaining = formatRemainingTime(sub.remainingTime);
        const planName = formatPlanType(sub.type);
        const ipLine = sub.registeredIp
          ? `🔗 آی‌پی ثبت‌شده: \`${sub.registeredIp}\``
          : '⚠️ *هیچ آی‌پی ثبت نشده است!*\nبرای فعال‌سازی سرویس، حتماً آی‌پی خود را ثبت کنید.';

        await ctx.reply(
          `🎮 *پلن و دی‌ان‌اس من*\n\n` +
          `📋 *پلن:* ${planName}\n` +
          `⏳ *زمان باقی‌مانده:* ${remaining}\n` +
          `${ipLine}\n\n` +
          `🌐 *DNS سرور:*\n` +
          `🔹 Primary: \`185.226.119.97\`\n` +
          `🔸 Secondary: \`185.226.117.62\`\n\n` +
          `⚠️ *توجه مهم:* دسترسی شما صرفاً بر اساس آی‌پی ثبت‌شده محدود می‌شود.\n` +
          `اگر آی‌پی اینترنت شما تغییر کند (مثلاً با ریست مودم)، باید از طریق\n` +
          `«🌐 ثبت آی‌پی من» آی‌پی جدید را ثبت کنید.`,
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
        '⚡️ *ثبت خودکار آی‌پی*\n\n' +
        'روی لینک زیر کلیک کنید تا آی‌پی شما به صورت آنی شناسایی و فعال شود:\n\n' +
        `👉 [ثبت و فعال‌سازی آی‌پی من](${quickRegisterUrl})\n\n` +
        '_همچنین می‌توانید آی‌پی اینترنت خود را به صورت دستی در چت بفرستید._',
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
          const planTitle = resolvePlanTitle(plan);
          await ctx.reply(
            `📦 *${planTitle}*\n` +
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
            `${i + 1}. ${resolvePlanTitle(p)} — ${p.price.toLocaleString('fa-IR')} تومان`
          );
          const inlineButtons = plans.map(p => [
            Markup.button.callback(`📦 ${resolvePlanTitle(p)}`, `select_plan_${p.id}`)
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
        '`185.226.119.97`\n\n' +
        '*آموزش تنظیم در سیستم‌عامل‌های مختلف:*\n\n' +
        '1️⃣ *ویندوز:*\n' +
        '   - تنظیمات شبکه ← اینترنت → تغییر تنظیمات آداپتور\n' +
        '   - روی اتصال خود کلیک راست → Properties\n' +
        '   - Internet Protocol Version 4 (TCP/IPv4) → Properties\n' +
        '   - Use the following DNS server addresses\n' +
        '   - DNS: `185.226.119.97`\n\n' +
        '2️⃣ *اندروید:*\n' +
        '   - Settings → Wi-Fi → شبکه فعلی\n' +
        '   - Modify network → Advanced → IP settings → Static\n' +
        '   - DNS: `185.226.119.97`\n\n' +
        '3️⃣ *iOS:*\n' +
        '   - Settings → Wi-Fi → شبکه فعلی\n' +
        '   - Configure DNS → Manual\n' +
        '   - DNS: `185.226.119.97`\n\n' +
        '4️⃣ *لینوکس / مک:*\n' +
        '   - تنظیمات شبکه → DNS\n' +
        '   - افزودن `185.226.119.97`',
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
  // New inline button handlers for notifications
  bot.action('register_ip', async (ctx: any) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const quickRegisterUrl = buildQuickRegisterUrl(telegramId);
    await ctx.reply(
      '⚡️ *ثبت خودکار آی‌پی*\n\n' +
      'روی لینک زیر کلیک کنید تا آی‌پی شما به صورت آنی شناسایی و فعال شود:\n\n' +
      `👉 [ثبت و فعال‌سازی آی‌پی من](${quickRegisterUrl})\n\n` +
      '_همچنین می‌توانید آی‌پی اینترنت خود را به صورت دستی در چت بفرستید._',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚀 ثبت و اتصال خودکار آی‌پی", url: quickRegisterUrl }]
          ]
        }
      }
    );
  });

  bot.action('guide_connection', async (ctx: any) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '⚙️ *راهنمای تنظیم DNS*\n\n' +
      'برای استفاده از سرویس، DNS سرور خود را به آدرس زیر تغییر دهید:\n\n' +
      '`185.226.119.97`\n\n' +
      '*آموزش تنظیم در سیستم‌عامل‌های مختلف:*\n\n' +
      '1️⃣ *ویندوز:*\n' +
      '   - تنظیمات شبکه ← اینترنت → تغییر تنظیمات آداپتور\n' +
      '   - روی اتصال خود کلیک راست → Properties\n' +
      '   - Internet Protocol Version 4 (TCP/IPv4) → Properties\n' +
      '   - Use the following DNS server addresses\n' +
      '   - DNS: `185.226.119.97`\n\n' +
      '2️⃣ *اندروید:*\n' +
      '   - Settings → Wi-Fi → شبکه فعلی\n' +
      '   - Modify network → Advanced → IP settings → Static\n' +
      '   - DNS: `185.226.119.97`\n\n' +
      '3️⃣ *iOS:*\n' +
      '   - Settings → Wi-Fi → شبکه فعلی\n' +
      '   - Configure DNS → Manual\n' +
      '   - DNS: `185.226.119.97`\n\n' +
      '4️⃣ *لینوکس / مک:*\n' +
      '   - تنظیمات شبکه → DNS\n' +
      '   - افزودن `185.226.119.97`',
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('renew_subscription', async (ctx: any) => {
    await ctx.answerCbQuery();
    const plans = await getPlans();
    if (!plans || plans.length === 0) {
      await ctx.reply('❌ هیچ پلن فعالی یافت نشد.');
      return;
    }
    const inlineButtons = plans.map(p => [
      { text: `📦 ${resolvePlanTitle(p)}`, callback_data: `select_plan_${p.id}` }
    ]);
    await ctx.reply(
      '💳 *تمدید اشتراک*\n\n' +
      'لطفاً پلن مورد نظر خود را انتخاب کنید:',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineButtons }
      }
    );
  });

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
    const remaining = formatRemainingTime(sub.remainingTime);
    const planName = formatPlanType(sub.type);
    await ctx.reply(
      `📊 *وضعیت اشتراک*\n\n` +
      `📋 نوع: ${planName}\n` +
      `📅 شروع: ${new Date(sub.startDate).toLocaleDateString('fa-IR')}\n` +
      `📅 پایان: ${new Date(sub.endDate).toLocaleDateString('fa-IR')}\n` +
      `⏳ زمان باقی‌مانده: ${remaining}\n` +
      (sub.registeredIp ? `🔗 آی‌پی ثبت‌شده: \`${sub.registeredIp}\`` : '🔗 هیچ آی‌پی ثبت نشده است'),
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
  });

  bot.action('dns_guide', async (ctx: any) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '⚙️ *راهنمای تنظیم DNS*\n\n' +
      'برای استفاده از سرویس، DNS سرور خود را به آدرس زیر تغییر دهید:\n\n' +
      '`185.226.119.97`\n\n' +
      '*آموزش تنظیم در سیستم‌عامل‌های مختلف:*\n\n' +
      '1️⃣ *ویندوز:*\n' +
      '   - تنظیمات شبکه ← اینترنت → تغییر تنظیمات آداپتور\n' +
      '   - روی اتصال خود کلیک راست → Properties\n' +
      '   - Internet Protocol Version 4 (TCP/IPv4) → Properties\n' +
      '   - Use the following DNS server addresses\n' +
      '   - DNS: `185.226.119.97`\n\n' +
      '2️⃣ *اندروید:*\n' +
      '   - Settings → Wi-Fi → شبکه فعلی\n' +
      '   - Modify network → Advanced → IP settings → Static\n' +
      '   - DNS: `185.226.119.97`\n\n' +
      '3️⃣ *iOS:*\n' +
      '   - Settings → Wi-Fi → شبکه فعلی\n' +
      '   - Configure DNS → Manual\n' +
      '   - DNS: `185.226.119.97`\n\n' +
      '4️⃣ *لینوکس / مک:*\n' +
      '   - تنظیمات شبکه → DNS\n' +
      '   - افزودن `185.226.119.97`',
      { parse_mode: 'Markdown', ...mainKeyboard }
    );
  });

  // Helper to extract ID from callback_data safely
  const getCallbackData = (ctx: any): string => ctx.callbackQuery?.data || '';

  // Payment: select plan (multi-plan flow)
  bot.action(/^select_plan_/, async (ctx: any) => {
    await ctx.answerCbQuery();
    const data = getCallbackData(ctx);
    const planId = data.replace('select_plan_', '');
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
    const data = getCallbackData(ctx);
    const planId = data.replace('single_discount_', '');
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
    const data = getCallbackData(ctx);
    const planId = data.replace('single_nodiscount_', '');
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

      // Fetch plan info to show title in checkout message
      let checkoutPlanTitle = planTitle || '';
      if (!checkoutPlanTitle) {
        try {
          const plans = await getPlans();
          const plan = plans.find(p => p.id === planId);
          if (plan) {
            checkoutPlanTitle = resolvePlanTitle(plan);
          }
        } catch { /* ignore, use fallback */ }
      }
      checkoutPlanTitle = checkoutPlanTitle || 'اشتراک ویژه';

      await ctx.reply(
        '🏷 *پلن انتخابی:* ' + checkoutPlanTitle + '\n' +
        '💰 *مبلغ نهایی:* ' + checkoutResult.amount.toLocaleString('fa-IR') + ' تومان\n\n' +
        'جهت تکمیل خرید روی لینک زیر کلیک کنید:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔗 ورود به درگاه پرداخت', url: checkoutResult.paymentUrl }]
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
            `Primary DNS: \`185.226.119.97\``,
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