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

const POSTED_NEWS_KEY = 'channel:posted_news';
const POSTED_NEWS_TEXT_KEY = 'channel:posted_news_texts';
const POSTED_PROMO_KEY = 'channel:posted_promos';

// In-memory fallbacks guarantee dedup even if Redis is unavailable
const memoryPostedNews = new Set<string>();
const memoryPostedNewsText = new Set<string>();
const memoryPostedPromos = new Set<string>();

async function sIsMember(redis: any, key: string, member: string): Promise<boolean> {
    if (!redis) return false;
    try {
        // redis v4+ (promise-based client): has sIsMember
        if (typeof redis.sIsMember === 'function') {
            const result = await redis.sIsMember(key, member);
            return result === true || result === 1;
        }
        // redis v2 (callback-based client): pass a callback to promisify
        if (typeof redis.sismember === 'function') {
            return await new Promise<boolean>((resolve) => {
                try {
                    redis.sismember(key, member, (err: any, reply: any) => {
                        if (err) resolve(false);
                        else resolve(reply === 1 || reply === true);
                    });
                } catch { resolve(false); }
            });
        }
        return false;
    } catch {
        return false;
    }
}

async function sAdd(redis: any, key: string, member: string): Promise<void> {
    if (!redis) return;
    try {
        if (typeof redis.sAdd === 'function') {
            await redis.sAdd(key, member);
            return;
        }
        if (typeof redis.sadd === 'function') {
            await new Promise<void>((resolve) => {
                try { redis.sadd(key, member, () => resolve()); } catch { resolve(); }
            });
        }
    } catch { /* ignore */ }
}

async function checkIsPosted(redis: any, url: string): Promise<boolean> {
    if (memoryPostedNews.has(url)) return true;
    return sIsMember(redis, POSTED_NEWS_KEY, url);
}

async function markAsPosted(redis: any, url: string): Promise<void> {
    memoryPostedNews.add(url);
    await sAdd(redis, POSTED_NEWS_KEY, url);
}

function normalizePostText(text: string): string {
    return text.replace(/\s+/g, ' ').replace(/[*_~`>#+\-=|{}.!]/g, '').trim();
}

async function isTextDuplicate(redis: any, text: string, key: string, memory: Set<string>): Promise<boolean> {
    const normalized = normalizePostText(text);
    if (!normalized) return true;
    if (memory.has(normalized)) return true;
    return sIsMember(redis, key, normalized);
}

async function markTextPosted(redis: any, text: string, key: string, memory: Set<string>): Promise<void> {
    const normalized = normalizePostText(text);
    if (!normalized) return;
    memory.add(normalized);
    await sAdd(redis, key, normalized);
}

async function isPromoDuplicate(redis: any, topic: string, text?: string): Promise<boolean> {
    if (memoryPostedPromos.has(topic)) return true;
    if (await sIsMember(redis, POSTED_PROMO_KEY, topic)) return true;
    // Also guard against legacy entries that stored the rendered post body
    if (text && await isTextDuplicate(redis, text, POSTED_PROMO_KEY, new Set<string>())) return true;
    return false;
}

async function markPromoPosted(redis: any, topic: string, text?: string): Promise<void> {
    memoryPostedPromos.add(topic);
    await sAdd(redis, POSTED_PROMO_KEY, topic);
    if (text) await markTextPosted(redis, text, POSTED_PROMO_KEY, new Set<string>());
}

async function isNewsTextDuplicate(redis: any, text: string): Promise<boolean> {
    return isTextDuplicate(redis, text, POSTED_NEWS_TEXT_KEY, memoryPostedNewsText);
}

async function markNewsTextPosted(redis: any, text: string): Promise<void> {
    await markTextPosted(redis, text, POSTED_NEWS_TEXT_KEY, memoryPostedNewsText);
}

let newsPublishInFlight = false;

export async function publishLatestGamingNews(bot: Telegraf<any>, redisClient: any) {
    if (newsPublishInFlight) {
        console.log('[ChannelPublisher] News publish already in progress, skipping.');
        return false;
    }
    newsPublishInFlight = true;
    try {
        return await doPublishLatestGamingNews(bot, redisClient);
    } finally {
        newsPublishInFlight = false;
    }
}

async function doPublishLatestGamingNews(bot: Telegraf<any>, redisClient: any): Promise<boolean> {
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

        // Final guard: never publish a title we already posted (even with a new URL)
        if (await isNewsTextDuplicate(redisClient, item.title)) {
            console.log(`[ChannelPublisher] Skipping already-posted title: ${item.title}`);
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
        await markNewsTextPosted(redisClient, item.title);
        console.log(`[ChannelPublisher] Successfully posted gaming news: ${item.title}`);
        return true;
    }

    console.log('[ChannelPublisher] No new gaming news found to publish.');
    return false;
}


const TOPIC_IMAGES: Record<string, string> = {
    warzone: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1200&auto=format&fit=crop',
    fc25: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=1200&auto=format&fit=crop',
    valorant: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?q=80&w=1200&auto=format&fit=crop',
    quick_register: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=1200&auto=format&fit=crop',
    free_trial: 'https://images.unsplash.com/photo-1612287271162-26466986503d?q=80&w=1200&auto=format&fit=crop',
};

let promoPublishInFlight = false;

export async function publishDnsPromo(bot: Telegraf<any>, redisClient?: any) {
    if (promoPublishInFlight) {
        console.log('[ChannelPublisher] DNS promo publish already in progress, skipping.');
        return false;
    }
    promoPublishInFlight = true;
    try {
        return await doPublishDnsPromo(bot, redisClient);
    } finally {
        promoPublishInFlight = false;
    }
}

async function doPublishDnsPromo(bot: Telegraf<any>, redisClient?: any): Promise<boolean> {
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

    // Pick a topic that has never been published before; never repeat one
    for (const topic of Object.keys(TOPIC_IMAGES)) {
        if (await isPromoDuplicate(redisClient, topic)) continue;

        const promo = await generateDnsPromoCopy(topic);

        const plainText = promo.text
            .replace(/[*_~`>#+\-=|{}.!]/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

        if (await isTextDuplicate(redisClient, plainText, POSTED_PROMO_KEY, memoryPostedPromos)) {
            console.log(`[ChannelPublisher] Promo text for topic "${topic}" already posted, skipping...`);
            continue;
        }

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

        await bot.telegram.sendPhoto(channelId, imageUrl, {
            caption: plainText,
            reply_markup: { inline_keyboard: inlineKeyboard },
        });

        await markPromoPosted(redisClient, promo.topic, plainText);
        console.log(`[ChannelPublisher] Successfully published DNS Promo for topic: ${promo.topic}`);
        return true;
    }

    // All topics already posted — do not repeat
    console.log('[ChannelPublisher] All DNS promo topics already posted.');
    return false;
}