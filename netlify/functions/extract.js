exports.handler = async function(event, context) {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const SCRAPING_KEY = process.env.SCRAPINGANT_API_KEY;

    if (!BOT_TOKEN || !SCRAPING_KEY) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: "المفاتيح غير موجودة" }) };
    }

    if (event.httpMethod !== 'POST') return { statusCode: 405, body: "Method Not Allowed" };

    let body;
    try { body = JSON.parse(event.body); } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    const { targetUrl, chatId } = body;

    try {
        // 1. جلب الصفحة من ScrapingAnt (مع إعدادات إضافية لضمان عدم الحظر)
        // ضفنا &proxy_country=US عشان يستخدم بروكسي أمريكي، وضفنا headers
        const scrapeUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${SCRAPING_KEY}&browser=true`;
        
        const pageResponse = await fetch(scrapeUrl);
        const responseText = await pageResponse.text(); // بنقرا الرد كنص الأول

        // لو الرد فيه < يبقى ده HTML مش JSON (يعني فيه خطأ)
        if (responseText.trim().startsWith('<')) {
            // إرسال الخطأ لتيليجرام عشان تشوفه
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: "⚠️ خطأ من ScrapingAnt: الموقع رفض الطلب أو المفتاح غير صالح. الرد:\n" + responseText.substring(0, 500) })
            });
            throw new Error("ScrapingAnt رجع صفحة HTML (خطأ)");
        }

        const responseData = JSON.parse(responseText);
        
        if (!responseData.content && !responseData.html) {
            throw new Error("لا يوجد محتوى في الرد");
        }

        const html = responseData.content || responseData.html;
        const foundLinks = new Set();

        // 2. استخراج الملفات
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

        const styleRegex = /url\(['"]?([^'")]+)['"]?\)/gi;
        while ((match = styleRegex.exec(html)) !== null) {
            try { foundLinks.add(new URL(match[1], targetUrl).href); } catch (e) {}
        }

        const jsRegex = /["'](https?:\/\/[^"']+\.(jpg|jpeg|png|gif|webp|pdf|zip|mp4|mp3|docx|xlsx|svg))["']/gi;
        while ((match = jsRegex.exec(html)) !== null) {
            try { foundLinks.add(match[1]); } catch (e) {}
        }

        const linksArray = Array.from(foundLinks);

        if (linksArray.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ success: true, sent: 0, message: "لم يتم العثور على أي ملفات." }) };
        }

        // 3. إرسال تقرير
        const reportText = `🔍 تم العثور على ${linksArray.length} ملف.\nأول 5 روابط:\n\n` + linksArray.slice(0, 5).join('\n\n');
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: reportText, disable_web_page_preview: true })
        });

        // 4. تحميل وإرسال الملفات
        const MAX_FILES = 15; 
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
            } catch (err) { console.log("Failed:", fileName); }
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ success: true, sent: sentCount, note: `تم إرسال ${sentCount} من أصل ${linksArray.length} ملف.` }) 
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }
};
