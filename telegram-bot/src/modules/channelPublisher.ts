import Parser from 'rss-parser';
import { Telegraf } from 'telegraf';
import { rewriteGamingNews } from '../services/aiWriter';

const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['enclosure', 'enclosure'],
        ],
    },
});

const RSS_FEEDS = [
    'https://www.pcgamer.com/rss/',
    'https://feeds.feedburner.com/ign/all',
];

export async function publishLatestGamingNews(bot: Telegraf<any>, redisClient: any) {
    const channelId = process.env.CHANNEL_ID;
    const botUsername = process.env.BOT_USERNAME || 'MyDnsBot';

    if (!channelId) {
        console.warn('[ChannelPublisher] CHANNEL_ID is not configured.');
        return;
    }

    for (const feedUrl of RSS_FEEDS) {
        try {
            const feed = await parser.parseURL(feedUrl);
            const items = feed.items.slice(0, 5);

            for (const item of items) {
                if (!item.link || !item.title) continue;

                const alreadyPosted = await checkIsPosted(redisClient, item.link);
                if (alreadyPosted) continue;

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
                console.log(`[ChannelPublisher] Successfully posted: ${item.title}`);
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