export async function rewriteGamingNews(rawTitle: string, rawSnippet: string): Promise<string> {
    const apiKey = process.env.GAPGPT_API_KEY;
    const baseUrl = process.env.GAPGPT_BASE_URL || 'https://api.gapgpt.app/v1';
    const model = process.env.GAPGPT_MODEL || 'deepseek-chat';

    if (!apiKey) {
        throw new Error('GAPGPT_API_KEY is not defined');
    }

    const systemPrompt = `تو یک گیمر ایرانی پرو و کارکشته هستی که داخل کانال تلگرام گیمینگ خودت پست می‌ذاری.
وظیفه داری خبر یا رویداد خامی که بهت داده می‌شه رو در ۲ الی ۳ پاراگراف خیلی کوتاه، رفاقتی، جذاب، کوبنده و بدون مقدمه‌چینی رباتی بازنویسی کنی.

قوانین:
۱. از کلمات کلیشه‌ای مثل «سلام رفقا»، «در دنیای بازی‌ها»، «با ما همراه باشید» استفاده نکن؛ مستقیم برو سراغ اصل موضوع.
۲. حتماً در انتهای متن خیلی طبیعی و کوتاه اشاره کن که برای پینگ پایدار، دور زدن تحریم و پکت‌لاست صفر می‌تونن از دی‌ان‌اس اختصاصی سرور استفاده کنن.
۳. متن نهایی باید حداکثر ۵۰۰ کاراکتر باشه تا توی کپشن عکس تلگرام کامل جا بشه.
۴. لحن باید عامیانه، پرانرژی و متناسب با جامعه گیمرها باشه.`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `عنوان خبر: ${rawTitle}\nمتن خام: ${rawSnippet}` },
            ],
            temperature: 0.7,
            max_tokens: 400,
        }),
    });

    if (!response.ok) {
        throw new Error(`AI API error: ${response.status} - ${await response.text()}`);
    }

    const data: any = await response.json();
    return data.choices[0]?.message?.content?.trim() || rawSnippet;
}