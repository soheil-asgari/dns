import type { Context } from 'telegraf';
import { api, syncToRedis, fetchBotAdminIds } from '../services/api.js';

let cachedAdminIds: number[] | null = null;
let lastFetch = 0;

async function getAdminIds(): Promise<number[]> {
    const envIds = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
    
    if (!cachedAdminIds || Date.now() - lastFetch > 5 * 60 * 1000) {
        try {
            const backendIds = await fetchBotAdminIds();
            cachedAdminIds = [...new Set([...envIds, ...backendIds])];
            lastFetch = Date.now();
        } catch {
            cachedAdminIds = envIds;
        }
    }
    
    return cachedAdminIds || envIds;
}

export async function isAdmin(ctx: Context): Promise<boolean> {
    const telegramId = ctx.from?.id || 0;
    if (!telegramId) return false;
    const adminIds = await getAdminIds();
    return adminIds.includes(telegramId);
}

export async function adminHandler(ctx: Context) {
    const authorized = await isAdmin(ctx);
    if (!authorized) {
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

        case 'reload':
            cachedAdminIds = null;
            await ctx.reply('✅ Admin cache cleared. Will re-fetch on next command.');
            break;

        default:
            await ctx.reply(
                '*🧪 Admin Commands:*\n\n' +
                '/admin sync - Sync DNS data to Redis\n' +
                '/admin reload - Reload admin list from backend\n' +
                '/addadmin <telegram_id> - Add a Telegram user as bot admin\n' +
                '/removeadmin <telegram_id> - Remove a Telegram user from bot admin\n' +
                '/listadmins - List all bot admin Telegram IDs\n',
                { parse_mode: 'Markdown' }
            );
    }
}

export async function addAdminHandler(ctx: Context) {
    const authorized = await isAdmin(ctx);
    if (!authorized) {
        await ctx.reply('⛔ Unauthorized.');
        return;
    }

    const args = (ctx.message as any)?.text?.split(' ');
    const targetId = parseInt(args?.[1]);
    if (!targetId || isNaN(targetId)) {
        await ctx.reply('❌ Usage: /addadmin <telegram_id>\nExample: /addadmin 123456789');
        return;
    }

    try {
        // Get current admin IDs from backend
        const { data } = await api.get('/api/settings/bot-admin-ids', {
            headers: { 'X-Internal-Service': 'telegram-bot' }
        });
        let ids: number[] = data.adminIds || [];
        
        if (ids.includes(targetId)) {
            await ctx.reply(`⚠️ ${targetId} is already an admin.`);
            return;
        }

        ids.push(targetId);
        await api.put('/api/settings/bot-admin-ids', { adminIds: ids }, {
            headers: { 'X-Internal-Service': 'telegram-bot' }
        });
        
        // Clear cache
        cachedAdminIds = null;
        
        await ctx.reply(`✅ Telegram ID \`${targetId}\` added as bot admin.`);
    } catch (err: any) {
        await ctx.reply(`❌ Failed to add admin: ${err?.message || err}`);
    }
}

export async function removeAdminHandler(ctx: Context) {
    const authorized = await isAdmin(ctx);
    if (!authorized) {
        await ctx.reply('⛔ Unauthorized.');
        return;
    }

    const args = (ctx.message as any)?.text?.split(' ');
    const targetId = parseInt(args?.[1]);
    if (!targetId || isNaN(targetId)) {
        await ctx.reply('❌ Usage: /removeadmin <telegram_id>\nExample: /removeadmin 123456789');
        return;
    }

    try {
        const { data } = await api.get('/api/settings/bot-admin-ids', {
            headers: { 'X-Internal-Service': 'telegram-bot' }
        });
        let ids: number[] = data.adminIds || [];
        
        if (!ids.includes(targetId)) {
            await ctx.reply(`⚠️ ${targetId} is not an admin.`);
            return;
        }

        ids = ids.filter(id => id !== targetId);
        await api.put('/api/settings/bot-admin-ids', { adminIds: ids }, {
            headers: { 'X-Internal-Service': 'telegram-bot' }
        });
        
        cachedAdminIds = null;
        
        await ctx.reply(`✅ Telegram ID \`${targetId}\` removed from bot admins.`);
    } catch (err: any) {
        await ctx.reply(`❌ Failed to remove admin: ${err?.message || err}`);
    }
}

export async function listAdminsHandler(ctx: Context) {
    const authorized = await isAdmin(ctx);
    if (!authorized) {
        await ctx.reply('⛔ Unauthorized.');
        return;
    }

    try {
        // Get env IDs too
        const envIds = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
        
        const { data } = await api.get('/api/settings/bot-admin-ids', {
            headers: { 'X-Internal-Service': 'telegram-bot' }
        });
        const backendIds: number[] = data.adminIds || [];
        const allIds = [...new Set([...envIds, ...backendIds])];

        if (allIds.length === 0) {
            await ctx.reply('📋 No bot admins configured.');
            return;
        }

        const lines = allIds.map((id: number) => {
            const source = envIds.includes(id) && backendIds.includes(id) ? '🌐 env+panel'
                : envIds.includes(id) ? '⚙️ env' : '🖥️ panel';
            return `\`${id}\` ${source}`;
        });

        await ctx.reply(
            `📋 *Bot Admins (${allIds.length})*\n\n${lines.join('\n')}`,
            { parse_mode: 'Markdown' }
        );
    } catch (err: any) {
        await ctx.reply(`❌ Failed to list admins: ${err?.message || err}`);
    }
}