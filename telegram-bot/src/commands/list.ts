import type { Context } from 'telegraf';
import { getGamingDomains } from '../services/api.js';

export async function listHandler(ctx: Context) {
  try {
    const domains = await getGamingDomains();

    if (!domains.length) {
      await ctx.reply('No gaming domains configured.');
      return;
    }

    const lines = domains.map((d: any, i: number) =>
      `${i + 1}. *${d.gameName}* - \`${d.domain}\` ${d.isActive ? '✅' : '❌'}`
    );

    await ctx.reply(
      `🎮 *Gaming Domains (${domains.length})*\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    await ctx.reply(`❌ Error fetching domains: ${error.message}`);
  }
}