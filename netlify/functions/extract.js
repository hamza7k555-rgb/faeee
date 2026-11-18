exports.handler = async function(event) {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const SCRAPING_KEY = process.env.SCRAPINGANT_API_KEY; // المفتاح الجديد

    if (!BOT_TOKEN || !SCRAPING_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "Missing API Keys" }) };
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: "Method Not Allowed" };

    let body;
    try { body = JSON.parse(event.body); } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    const { targetUrl, chatId } = body;
    if (!targetUrl || !chatId) return { statusCode: 400, body: JSON.stringify({ error: "Missing params" }) };

    try {
        // 1. استخدام ScrapingAnt كـ "متصفح خفي" عشان يكسر الحماية ويجيب الصفحة بعد تحميل الجافاسكريبت
        const scrapeApiUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${SCRAPING_KEY}&browser=true`;
        
        const pageResponse = await fetch(scrapeApiUrl);
        if (!pageResponse.ok) throw new Error("فشل الاتصال بخدمة المتصفح الخفي");
        
        const html = await pageResponse.text();

        // 2. استخراج كل الملفات من الكود النهائي
        const foundLinks = new Set();
        const regex = /(?:https?:\/\/|\/)[^\s"'<>\(\)]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|ico|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|mp4|avi|mov|wmv|flv|mkv|mp3|wav|aac|ogg|m4a|txt|csv|json|xml|js|css|map|woff|woff2|ttf|otf|html|htm)(?:\?[^\s"'<>]*)?/gi;
        
        let match;
        while ((match = regex.exec(html)) !== null) {
            try {
                const abs = new URL(match[0], targetUrl).href;
                if (abs.startsWith('http') && !abs.includes('w3.org') && !abs.includes('schema.org') && !abs.includes('google-analytics')) {
                    foundLinks.add(abs);
                }
            } catch (e) {}
        }

        // استخراج الصور المخفية في الستايل
        const styleRegex = /url\(['"]?([^'")]+)['"]?\)/gi;
        while ((match = styleRegex.exec(html)) !== null) {
            try { foundLinks.add(new URL(match[1], targetUrl).href); } catch (e) {}
        }

        const linksArray = Array.from(foundLinks);

        if (linksArray.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ success: true, sent: 0, message: "مفيش ملفات خالص حتى بعد كسر الحماية." }) };
        }

        // 3. تحميل وإرسال الملفات
        const MAX_FILES = 10; 
        const filesToSend = linksArray.slice(0, MAX_FILES);
        let sentCount = 0;

        for (const fileUrl of filesToSend) {
            const fileName = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]) || 'file';
            try {
                const fileResponse = await fetch(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (!fileResponse.ok) continue;
                
                const buffer = Buffer.from(await fileResponse.arrayBuffer());
                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('document', new Blob([buffer]), fileName);

                const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
                const tgData = await tgRes.json();
                
                if (tgData.ok) sentCount++;
            } catch (err) {
                console.log("Failed to send:", fileName);
            }
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                success: true, 
                sent: sentCount,
                totalFound: linksArray.length,
                note: linksArray.length > MAX_FILES ? `تم العثور على ${linksArray.length} ملف، وتم إرسال أول ${MAX_FILES}.` : ""
            }) 
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }
};
