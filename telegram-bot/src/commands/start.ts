import type { Context } from 'telegraf';

export async function startHandler(ctx: Context) {
  const username = ctx.from?.first_name || 'User';
  await ctx.reply(
    `🎮 *DNS Manager Bot*\n\nHello ${username}! I can help you manage your gaming DNS infrastructure.\n\n` +
    '*Available Commands:*\n' +
    '/dns `<domain>` - Resolve a domain\n' +
    '/list - List gaming domains\n' +
    '/stats - Show DNS statistics\n' +
    '/admin - Admin commands (restricted)\n' +
    '/help - Show this message',
    { parse_mode: 'Markdown' }
  );
}

export async function helpHandler(ctx: Context) {
  await startHandler(ctx);
}