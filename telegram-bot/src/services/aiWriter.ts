export async function rewriteGamingNews(rawTitle: string, rawSnippet: string): Promise<string> {
    const apiKey = process.env.GAPGPT_API_KEY;
    const baseUrl = process.env.GAPGPT_BASE_URL || 'https://api.gapgpt.app/v1';
    const model = process.env.GAPGPT_MODEL || 'deepseek-chat';

    if (!apiKey) {
        throw new Error('GAPGPT_API_KEY is not defined');
    }

    const systemPrompt = `تو یک سردبیر خبری گیمینگ حرفه‌ای و کارکشته‌ای که برای کانال تلگرامی پرطرفدار خودت مطلب می‌نویسی.

وظیفه: خبر خام انگلیسی که بهت داده می‌شه رو به فارسی روان، هیجانی و کاملاً گیمر-فرندلی بازنویسی کن.

سبک نگارش:
- یک تیتر جذاب و کوبنده با ایموجی‌های گیمینگ (🔥 🎮 ⚡ 🚀 🎯) در ابتدا
- ۲-۳ پاراگراف کوتاه و چکشی یا بولت‌پوینت‌های تیز و بدون توضیح اضافه
- از لحن خشک و ترجمه‌ماشینی پرهیز کن. طوری بنویس که یه گیمر ایرانی پای کامپیوترش هیجان‌زده بشه
- رپرتاژ آگهی و کلمات کلیشه‌ای ممنوع
- انتهای مطلب هشتگ‌های مرتبط گیمینگ (انگلیسی یا فارسی) اضافه کن

در انتهای متن (بعد از هشتگ‌ها) حتماً این فوتر برند را دقیق بیاور:
━━━━━━━━━━━━━━━━━━━
🛡️ پینگ پایین و بدون پکت‌لاس با دی‌ان‌اس راینو:
🆔 @rhynodns | @rhynodnsbot

متن نهایی حداکثر ۶۰۰ کاراکتر باشد.`;

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
            max_tokens: 500,
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
🔹 Primary: \`185.226.119.97\`
🔸 Secondary: \`185.226.117.62\`
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