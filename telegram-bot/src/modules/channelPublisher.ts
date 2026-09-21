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

// فقط فیدهای اختصاصی اخبار بازی‌ها (بدون فیلم، سریال و سخت‌افزار)
const RSS_FEEDS = [
    'https://www.gamespot.com/feeds/game-news/',
    'https://feeds.feedburner.com/ign/games-all',
    'https://www.pcgamer.com/news/rss/',
];

// لیست سیاه دسته‌بندی‌ها و کلماتی که ربطی به اخبار هیجانی بازی ندارند
const IGNORED_URL_PARTS = [
    'gaming-industry',
    'game-development',
    'hardware',
    'tech',
    'movie',
    'tv-shows',
    'comic',
    'review',
    'guide',
    'opinion',
    'deals',
];

// الگوهای query string که رزولوشن عکس رو پایین میارن
const RESIZE_QUERY_PATTERNS = [
    /\?w=\d+/i,
    /\?h=\d+/i,
    /\?width=\d+/i,
    /\?height=\d+/i,
    /\?quality=\d+/i,
    /\?resize=[^&]+/i,
    /\?fit=[^&]+/i,
    /\?auto=[^&]+/i,
    /\?crop=[^&]+/i,
    /\?scale=\d+/i,
];

// الگوی حذف پسوند CMS thumbnail مثل -150x150.jpg یا -300x200.png
const CMS_THUMBNAIL_SUFFIX = /-\d+x\d+(?=\.(jpg|jpeg|png|webp|gif|bmp))/i;

function isRelevantGamingNews(link: string, title: string): boolean {
    const lowerLink = link.toLowerCase();
    const lowerTitle = title.toLowerCase();

    for (const ignored of IGNORED_URL_PARTS) {
        if (lowerLink.includes(ignored) || lowerTitle.includes(ignored)) {
            return false;
        }
    }
    return true;
}

/**
 * استخراج لینک عکس با بالاترین رزولوشن ممکن از آیتم RSS
 * با پاک کردن query string های کاهش‌دهنده کیفیت و حذف سافیکس thumbnail
 */
function extractHighResImage(rssItem: any): string | null {
    // 1. media:content (first with image type)
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

    // 2. enclosure
    if (rssItem.enclosure && rssItem.enclosure.url) {
        if (!rssItem.enclosure.type || rssItem.enclosure.type.startsWith('image/')) {
            const cleaned = cleanImageUrl(rssItem.enclosure.url);
            if (cleaned) return cleaned;
        }
    }

    // 3. media:thumbnail
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

    // 4. Extract <img> from HTML content
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

/**
 * پاکسازی URL عکس: حذف query string های کاهش کیفیت، حذف سافیکس thumbnail و دیکد کردن موجودیت‌های HTML
 */
function cleanImageUrl(url: string): string | null {
    if (!url || typeof url !== 'string') return null;

    let cleaned = url.trim();

    // Decode HTML entities like & to &
    cleaned = cleaned.replace(/&/g, '&').replace(/&#038;/g, '&');

    // Remove CMS thumbnail size suffixes: -150x150.jpg -> .jpg
    cleaned = cleaned.replace(CMS_THUMBNAIL_SUFFIX, '');

    // Strip resize/downgrade query params
    for (const pattern of RESIZE_QUERY_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }

    // Clean up leftover trailing ? or & if query string was fully removed
    cleaned = cleaned.replace(/[?&]$/, '');

    return cleaned || null;
}

export async function publishLatestGamingNews(bot: Telegraf<any>, redisClient: any) {
    const channelId = process.env.CHANNEL_ID;
    const botUsername = process.env.BOT_USERNAME || 'rhynodnsbot';

    if (!channelId) {
        console.warn('[ChannelPublisher] CHANNEL_ID is not configured.');
        return;
    }

    for (const feedUrl of RSS_FEEDS) {
        try {
            const feed = await parser.parseURL(feedUrl);
            const items = feed.items.slice(0, 10); // بررسی ۱۰ آیتم اخیر برای پیدا کردن بهترین خبر

            for (const item of items) {
                if (!item.link || !item.title) continue;

                // ۱. فیلتر موضوعی: رد کردن مطالب صنعتی، سخت‌افزاری و غیرمرتبط
                if (!isRelevantGamingNews(item.link, item.title)) {
                    continue;
                }

                // ۲. رد کردن اخباری که قبلاً ارسال شده‌اند
                const alreadyPosted = await checkIsPosted(redisClient, item.link);
                if (alreadyPosted) continue;

                // ۳. استخراج عکس بنر خبر با بالاترین رزولوشن
                const imageUrl = extractHighResImage(item);

                const snippet = item.contentSnippet || item.content || item.title;
                let aiCaption = '';
                try {
                    aiCaption = await rewriteGamingNews(item.title, snippet);
                } catch (err) {
                    console.error('[ChannelPublisher] AI rewrite failed, skipping item:', err);
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

                if (imageUrl) {
                    await bot.telegram.sendPhoto(channelId, imageUrl, {
                        caption: aiCaption,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: inlineKeyboard },
                    });
                } else {
                    await bot.telegram.sendMessage(channelId, aiCaption, {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: inlineKeyboard },
                    });
                }

                await markAsPosted(redisClient, item.link);
                console.log(`[ChannelPublisher] Successfully posted gaming news: ${item.title}`);
                return;
            }
        } catch (error) {
            console.error(`[ChannelPublisher] Error reading feed ${feedUrl}:`, error);
        }
    }
}

function checkIsPosted(redis: any, url: string): Promise<boolean> {
    return new Promise((resolve) => {
        redis.sismember('channel:posted_news', url, (err: any, reply: number) => {
            if (err) resolve(false);
            resolve(reply === 1);
        });
    });
}

function markAsPosted(redis: any, url: string): Promise<void> {
    return new Promise((resolve) => {
        redis.sadd('channel:posted_news', url, () => {
            resolve();
        });
    });
}



// پوسترهای باکیف متناسب با هر موضوع
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

    await bot.telegram.sendPhoto(channelId, imageUrl, {
        caption: promo.text,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard },
    });

    console.log(`[ChannelPublisher] Successfully published DNS Promo for topic: ${promo.topic}`);
}