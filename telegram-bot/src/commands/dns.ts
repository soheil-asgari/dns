import type { Context } from 'telegraf';
import { resolveDomain } from '../services/api.js';

export async function dnsHandler(ctx: Context) {
  const domain = (ctx.message as any)?.text?.split(' ')[1];

  if (!domain) {
    await ctx.reply('Usage: /dns `<domain>`\nExample: /dns playstation.com', { parse_mode: 'Markdown' });
    return;
  }

  try {
    const result = await resolveDomain(domain);
    const msg = [
      `🔍 *DNS Resolution: ${domain}*`,
      '',
      `📌 *Domain:* ${result.domain}`,
      `🎮 *Gaming Domain:* ${result.isGamingDomain ? '✅ Yes' : '❌ No'}`,
      result.customIp ? `📍 *Custom IP:* \`${result.customIp}\`` : null,
      `🌐 *Resolved IP:* \`${result.resolvedIp || 'N/A'}\``,
    ].filter(Boolean).join('\n');

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error: any) {
    await ctx.reply(`❌ Error resolving domain: ${error.message}`);
  }
}