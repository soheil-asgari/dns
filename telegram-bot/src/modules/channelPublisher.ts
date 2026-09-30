import Parser from 'rss-parser';
import { Telegraf } from 'telegraf';

import { rewriteGamingNews, generateDnsPromoCopy } from '../services/aiWriter.js';

const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['enclosure', 'enclosure'],
            ['media:thumbnail', 'mediaThumbnail'],
        ],
    },
});

const RSS_FEEDS = [
    'https://www.gamespot.com/feeds/game-news/',
    'https://feeds.feedburner.com/ign/games-all',
    'https://www.polygon.com/rss/index.xml',
    'https://dotesports.com/feed',
    'https://www.videogameschronicle.com/feed/',
];

const PRIORITY_GAMES = [
    'call of duty', 'cod', 'warzone', 'black ops', 'modern warfare',
    'apex', 'apex legends', 'valorant',
    'fc', 'fc 24', 'fc 25', 'fifa', 'ea sports fc',
    'counter strike', 'cs2', 'cs:go', 'csgo',
    'fortnite', 'pubg', 'battlegrounds',
];

const IGNORED_URL_PARTS = [
    'gaming-industry', 'game-development', 'hardware', 'tech',
    'movie', 'tv-shows', 'comic', 'review', 'guide', 'opinion',
    'deals', 'food', 'entertainment', 'lifestyle', 'sports', 'politics', 'business',
];

const RESIZE_QUERY_PATTERNS = [
    /\?w=\d+/i, /\?h=\d+/i, /\?width=\d+/i, /\?height=\d+/i,
    /\?quality=\d+/i, /\?resize=[^&]+/i, /\?fit=[^&]+/i,
    /\?auto=[^&]+/i, /\?crop=[^&]+/i, /\?scale=\d+/i,
];

const CMS_THUMBNAIL_SUFFIX = /-\d+x\d+(?=\.(jpg|jpeg|png|webp|gif|bmp))/i;

function isRelevantGamingNews(link: string, title: string): boolean {
    const lowerLink = link.toLowerCase();
    const lowerTitle = title.toLowerCase();
    for (const ignored of IGNORED_URL_PARTS) {
        if (lowerLink.includes(ignored) || lowerTitle.includes(ignored)) return false;
    }
    return true;
}

function getGamePriorityScore(title: string): number {
    const lowerTitle = title.toLowerCase();
    for (let i = 0; i < PRIORITY_GAMES.length; i++) {
        if (lowerTitle.includes(PRIORITY_GAMES[i])) {
            return PRIORITY_GAMES.length - i;
        }
    }
    return 0;
}

function extractHighResImage(rssItem: any): string | null {
    const mc = rssItem.mediaContent;
    if (mc) {
        if (Array.isArray(mc)) {
            for (const m of mc) {
                if (m.$ && m.$.url && (!m.$.type || m.$.type.startsWith('image/'))) {
                    const cleaned = cleanImageUrl(m.$.url);
                    if (cleaned) return cleaned;
                }
            }
        } else if (mc.$ && mc.$.url) {
            const cleaned = cleanImageUrl(mc.$.url);
            if (cleaned) return cleaned;
        }
    }
    if (rssItem.enclosure && rssItem.enclosure.url) {
        if (!rssItem.enclosure.type || rssItem.enclosure.type.startsWith('image/')) {
            const cleaned = cleanImageUrl(rssItem.enclosure.url);
            if (cleaned) return cleaned;
        }
    }
    const mt = rssItem.mediaThumbnail;
    if (mt) {
        if (Array.isArray(mt)) {
            for (const t of mt) {
                if (t.$ && t.$.url) {
                    const cleaned = cleanImageUrl(t.$.url);
                    if (cleaned) return cleaned;
                }
            }
        } else if (mt.$ && mt.$.url) {
            const cleaned = cleanImageUrl(mt.$.url);
            if (cleaned) return cleaned;
        }
    }
    const htmlContent = rssItem.content || rssItem['content:encoded'] || '';
    if (htmlContent) {
        const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch && imgMatch[1]) {
            const cleaned = cleanImageUrl(imgMatch[1]);
            if (cleaned) return cleaned;
        }
    }
    return null;
}

function cleanImageUrl(url: string): string | null {
    if (!url || typeof url !== 'string') return null;
    let cleaned = url.trim();
    cleaned = cleaned.replace(/&/g, '&').replace(/&#038;/g, '&');
    cleaned = cleaned.replace(CMS_THUMBNAIL_SUFFIX, '');
    for (const pattern of RESIZE_QUERY_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    cleaned = cleaned.replace(/[?&]$/, '');
    return cleaned || null;
}

async function checkIsPosted(redis: any, url: string): Promise<boolean> {
    if (!redis || typeof redis.sismember !== 'function') {
        // Promise-based redis client
        try {
            const result = await redis.sismember('channel:posted_news', url);
            return result === 1;
        } catch { return false; }
    }
    // Callback-based redis client
    return new Promise((resolve) => {
        redis.sismember('channel:posted_news', url, (err: any, reply: number) => {
            if (err) resolve(false);
            else resolve(reply === 1);
        });
    });
}

async function markAsPosted(redis: any, url: string): Promise<void> {
    if (!redis || typeof redis.sadd !== 'function') {
        try { await redis.sadd('channel:posted_news', url); } catch { /* ignore */ }
        return;
    }
    return new Promise((resolve) => {
        redis.sadd('channel:posted_news', url, () => resolve());
    });
}

export async function publishLatestGamingNews(bot: Telegraf<any>, redisClient: any) {
    const channelId = process.env.CHANNEL_ID;
    const botUsername = process.env.BOT_USERNAME || 'rhynodnsbot';

    if (!channelId) {
        console.warn('[ChannelPublisher] CHANNEL_ID is not configured.');
        throw new Error('CHANNEL_ID is not configured.');
    }

    // Verify bot is admin in channel
    try {
        const botInfo = await bot.telegram.getMe();
        const chatMember = await bot.telegram.getChatMember(channelId, botInfo.id);
        if (chatMember.status !== 'administrator' && chatMember.status !== 'creator') {
            throw new Error('ربات در کانال ادمین نیست. لطفاً ربات را ادمین کانال کنید.');
        }
    } catch (err: any) {
        if (err.message?.includes('ربات در کانال ادمین نیست')) throw err;
        throw new Error(`ربات به کانال دسترسی ندارد: ${err?.message || err}`);
    }

    interface ScoredItem {
        item: any;
        score: number;
        feedUrl: string;
    }

    const allItems: ScoredItem[] = [];

    for (const feedUrl of RSS_FEEDS) {
        try {
            const feed = await parser.parseURL(feedUrl);
            const items = feed.items.slice(0, 15);

            for (const item of items) {
                if (!item.link || !item.title) continue;
                if (!isRelevantGamingNews(item.link, item.title)) continue;

                const alreadyPosted = await checkIsPosted(redisClient, item.link);
                if (alreadyPosted) continue;

                const score = getGamePriorityScore(item.title);
                if (score > 0) {
                    allItems.push({ item, score, feedUrl });
                }
            }
        } catch (error) {
            console.error(`[ChannelPublisher] Error reading feed ${feedUrl}:`, error);
        }
    }

    // If no priority items found, fallback to any relevant news
    if (allItems.length === 0) {
        for (const feedUrl of RSS_FEEDS) {
            try {
                const feed = await parser.parseURL(feedUrl);
                const items = feed.items.slice(0, 10);

                for (const item of items) {
                    if (!item.link || !item.title) continue;
                    if (!isRelevantGamingNews(item.link, item.title)) continue;

                    const alreadyPosted = await checkIsPosted(redisClient, item.link);
                    if (alreadyPosted) continue;

                    allItems.push({ item, score: 1, feedUrl });
                }
            } catch (error) {
                console.error(`[ChannelPublisher] Error reading feed ${feedUrl}:`, error);
            }
        }
    }

    allItems.sort((a, b) => b.score - a.score);

    for (const { item } of allItems) {
        const imageUrl = extractHighResImage(item);
        const snippet = item.contentSnippet || item.content || item.title;

        let aiCaption = '';
        try {
            aiCaption = await rewriteGamingNews(item.title, snippet);
        } catch (err) {
            console.error('[ChannelPublisher] AI rewrite failed, trying next item:', err);
            continue;
        }

        if (!aiCaption) {
            console.log(`[ChannelPublisher] AI skipped non-gaming news: ${item.title}`);
            continue;
        }

        const inlineKeyboard = [
            [
                { text: '🎮 دریافت دی‌ان‌اس و کاهش پینگ', url: `https://t.me/${botUsername.replace('@', '')}?start=channel` },
            ],
            [
                { text: '🌐 مشاهده منبع خبر', url: item.link },
            ],
        ];

        const cleanText = aiCaption.replace(/[*_~`>#+\-=|{}.!]/g, '');

        try {
            if (imageUrl) {
                await bot.telegram.sendPhoto(channelId, imageUrl, {
                    caption: cleanText,
                    reply_markup: { inline_keyboard: inlineKeyboard },
                });
            } else {
                await bot.telegram.sendMessage(channelId, cleanText, {
                    reply_markup: { inline_keyboard: inlineKeyboard },
                });
            }
        } catch (sendErr: any) {
            if (sendErr?.description?.includes('failed to get HTTP URL content') || sendErr?.description?.includes('IMAGE_PROCESS_FAILED')) {
                await bot.telegram.sendMessage(channelId, cleanText, {
                    reply_markup: { inline_keyboard: inlineKeyboard },
                });
            } else {
                throw sendErr;
            }
        }

        await markAsPosted(redisClient, item.link);
        console.log(`[ChannelPublisher] Successfully posted gaming news: ${item.title}`);
        return;
    }

    console.log('[ChannelPublisher] No new gaming news found to publish.');
}


const TOPIC_IMAGES: Record<string, string> = {
    warzone: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1200&auto=format&fit=crop',
    fc25: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=1200&auto=format&fit=crop',
    valorant: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?q=80&w=1200&auto=format&fit=crop',
    quick_register: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=1200&auto=format&fit=crop',
    free_trial: 'https://images.unsplash.com/photo-1612287271162-26466986503d?q=80&w=1200&auto=format&fit=crop',
};

export async function publishDnsPromo(bot: Telegraf<any>) {
    const channelId = process.env.CHANNEL_ID;
    const botUsername = process.env.BOT_USERNAME || 'rhynodnsbot';

    if (!channelId) {
        throw new Error('CHANNEL_ID is not configured.');
    }

    // Verify bot is admin in channel
    try {
        const botInfo = await bot.telegram.getMe();
        const chatMember = await bot.telegram.getChatMember(channelId, botInfo.id);
        if (chatMember.status !== 'administrator' && chatMember.status !== 'creator') {
            throw new Error('ربات در کانال ادمین نیست. لطفاً ربات را ادمین کانال کنید.');
        }
    } catch (err: any) {
        if (err.message?.includes('ربات در کانال ادمین نیست')) throw err;
        throw new Error(`ربات به کانال دسترسی ندارد: ${err?.message || err}`);
    }

    const promo = await generateDnsPromoCopy();
    const imageUrl = TOPIC_IMAGES[promo.topic] || TOPIC_IMAGES['warzone'];

    const inlineKeyboard = [
        [
            { text: '🎁 فعال‌سازی ۲۴ ساعت تست رایگان', url: `https://t.me/${botUsername.replace('@', '')}?start=promo` },
        ],
        [
            { text: '⚡ ثبت سریع آی‌پی (بدون رمز)', url: `https://t.me/${botUsername.replace('@', '')}?start=register_ip` },
            { text: '📖 آموزش تنظیم در کنسول', url: `https://t.me/${botUsername.replace('@', '')}?start=guide` },
        ],
    ];

    const plainText = promo.text
        .replace(/[*_~`>#+\-=|{}.!]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    await bot.telegram.sendPhoto(channelId, imageUrl, {
        caption: plainText,
        reply_markup: { inline_keyboard: inlineKeyboard },
    });

    console.log(`[ChannelPublisher] Successfully published DNS Promo for topic: ${promo.topic}`);
}