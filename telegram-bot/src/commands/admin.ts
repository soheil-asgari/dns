import type { Context } from 'telegraf';
import { syncToRedis } from '../services/api.js';

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number);

function isAdmin(ctx: Context): boolean {
  return ADMIN_IDS.includes(ctx.from?.id || 0);
}

export async function adminHandler(ctx: Context) {
  if (!isAdmin(ctx)) {
    await ctx.reply('⛔ Unauthorized. This command is restricted to admins.');
    return;
  }

  const args = (ctx.message as any)?.text?.split(' ');
  const subcommand = args?.[1];

  switch (subcommand) {
    case 'sync':
      try {
        await syncToRedis();
        await ctx.reply('✅ DNS data synced to Redis successfully.');
      } catch (error: any) {
        await ctx.reply(`❌ Sync failed: ${error.message}`);
      }
      break;

    default:
      await ctx.reply(
        '*Admin Commands:*\n\n' +
        '/admin sync - Sync DNS data to Redis\n' +
        '/admin reload - Reload configuration',
        { parse_mode: 'Markdown' }
      );
  }
}