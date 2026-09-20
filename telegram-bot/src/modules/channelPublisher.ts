import Parser from 'rss-parser';
import { Telegraf } from 'telegraf';

import { rewriteGamingNews, generateDnsPromoCopy } from '../services/aiWriter.js';

const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['enclosure', 'enclosure'],
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

                // ۳. استخراج عکس بنر خبر
                let imageUrl: string | undefined = undefined;
                if (item.enclosure && item.enclosure.url && item.enclosure.type?.startsWith('image/')) {
                    imageUrl = item.enclosure.url;
                } else if ((item as any).mediaContent && (item as any).mediaContent.$?.url) {
                    imageUrl = (item as any).mediaContent.$.url;
                }

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