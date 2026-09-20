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
export async function generateDnsPromoCopy(): Promise<{ text: string; topic: string }> {
    const apiKey = process.env.GAPGPT_API_KEY;
    const baseUrl = process.env.GAPGPT_BASE_URL || 'https://api.gapgpt.app/v1';
    const model = process.env.GAPGPT_MODEL || 'gpt-5.6-luna';

    const topics = [
        {
            name: 'warzone',
            prompt: 'رفع پکت‌لاست، ارور تایم‌اوت، فیکس شدن پینگ در وارزون و کالاف دیوتی، مچ‌میکینگ سریع‌تر روی سرورهای اروپا/خاورمیانه',
        },
        {
            name: 'fc25',
            prompt: 'رفع لگ سنگین و تاخیر دسته (Input Delay) در FC 25 / فیفا و آلتیمیت تیم، پینگ پایدار و بدون قطعی حین مسابقه',
        },
        {
            name: 'valorant',
            prompt: 'دور زدن تحریم و ارور اتصال ون‌گارد ولورانت (VAN Error) بدون نیاز به قندشکن، پینگ پایین و بدون پکت‌لاست',
        },
        {
            name: 'quick_register',
            prompt: 'معرفی ثبت آی‌پی با ۱ کلیک در راینو دی‌ان‌اس، بدون نیاز به نصب هیچ نرم‌افزار اضافی روی کنسول و کامپیوتر',
        },
        {
            name: 'free_trial',
            prompt: 'معرفی تست ۲۴ ساعته کاملاً رایگان سرویس راینو برای تست قبل از خرید، سرورهای اختصاصی و پرسرعت آلمان',
        },
    ];

    const selected = topics[Math.floor(Math.random() * topics.length)];

    const systemPrompt = `تو یک گیمر خوره و حرفه‌ای ایرانی هستی که داری سرویس DNS گیمینگ خودت (راینو دی‌ان‌اس / Rhyno DNS) رو به بچه‌های کانال تلگرام معرفی می‌کنی.
وظیفه داری یک پست کوتاه، پرانرژی، کوبنده و کاملاً دوستانه بنویسی.

قوانین سخت‌گیرانه:
۱. اصلاً و ابداً از کلمات رباتی یا کلیشه‌ای مثل «سلام دوستان»، «آیا از پینگ بالا خسته شدید؟»، «همراه ما باشید» استفاده نکن؛ مستقیم با یک جمله هیجانی و گیمری شروع کن.
۲. آدرس‌های DNS زیر را حتماً در متن به شکل مشخص بیاور:
🔹 Primary: \`37.32.28.44\`
🔸 Secondary: \`37.32.30.252\`
۳. حتماً اشاره کن که تست ۲۴ ساعته کاملاً رایگان در ربات فعال است.
۴. متن نهایی حداکثر در ۳ یا ۴ پاراگراف کوتاه (زیر ۵۰۰ کاراکتر) باشد تا در کپشن عکس جا شود.
۵. لحن عامیانه، صمیمی، پرو و تیکه‌انداز باشد.`;

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
                { role: 'user', content: `موضوع این پست: ${selected.prompt}` },
            ],
            temperature: 0.8,
            max_tokens: 450,
        }),
    });

    if (!response.ok) {
        throw new Error(`AI Promo error: ${response.status} - ${await response.text()}`);
    }

    const data: any = await response.json();
    const text = data.choices[0]?.message?.content?.trim() || '';
    return { text, topic: selected.name };
}