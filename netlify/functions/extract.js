const axios = require('axios');
const cheerio = require('cheerio');

// كل الامتدادات الممكنة
const ALLOWED_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|mp4|avi|mov|wmv|flv|mkv|mp3|wav|aac|ogg|m4a|txt|csv|json|xml|html|htm)(\?.*)?$/i;

exports.handler = async function(event) {
    const BOT_TOKEN = process.env.BOT_TOKEN;

    if (!BOT_TOKEN) return { statusCode: 500, body: JSON.stringify({ success: false, error: "Bot token missing" }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };

    let body;
    try { body = JSON.parse(event.body); } catch (e) { return { statusCode: 400, body: JSON.stringify({ success: false, error: "Invalid JSON" }) }; }

    const { targetUrl, chatId, fileTypes } = body;
    if (!targetUrl || !chatId) return { statusCode: 400, body: JSON.stringify({ success: false, error: "Missing params" }) };

    try {
        // 1. جلب الصفحة بتنكر شديد (عشان نكسر الحماية)
        const { data: html } = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 10000,
            maxRedirects: 5
        });

        const $ = cheerio.load(html);
        const foundLinks = new Set();
        const baseUrl = new URL(targetUrl);

        // دالة تحويل الروابط
        const fixUrl = (link) => {
            if (!link) return null;
            try {
                const abs = new URL(link, targetUrl).href;
                return ALLOWED_EXTENSIONS.test(abs) ? abs : null;
            } catch (e) { return null; }
        };

        // 2. الاستخراج الشرس (من كل مكان)
        // من img و source
        $('img, source, video, audio, a, link').each((i, el) => {
            const attrs = ['src', 'href', 'data-src', 'data-original', 'data-lazy-src', 'data-url', 'content'];
            attrs.forEach(attr => {
                const link = $(el).attr(attr);
                const fixed = fixUrl(link);
                if (fixed) foundLinks.add(fixed);
            });
        });

        // من الـ style
        $('[style*="url("]').each((i, el) => {
            const style = $(el).attr('style') || '';
            const matches = style.match(/url\(['"]?([^'")]+)['"]?\)/g) || [];
            matches.forEach(m => {
                const link = m.replace(/url\(['"]?|['"]?\)/g, '');
                const fixed = fixUrl(link);
                if (fixed) foundLinks.add(fixed);
            });
        });

        // من الـ Scripts والـ CSS المضمنة
        const scriptRegex = /(https?:\/\/[^\s"'<>\(\)]+\.(jpg|jpeg|png|gif|webp|pdf|zip|mp4|mp3|docx|xlsx|svg|ico))/gi;
        let match;
        while ((match = scriptRegex.exec(html)) !== null) {
            const fixed = fixUrl(match[1]);
            if (fixed) foundLinks.add(fixed);
        }

        let linksArray = Array.from(foundLinks);

        // فلترة حسب الاختيار
        if (fileTypes && Array.isArray(fileTypes) && fileTypes.length > 0) {
            const allowed = fileTypes.flatMap(t => t.split(',').map(x => x.trim().toLowerCase()));
            linksArray = linksArray.filter(link => {
                const ext = link.split('?')[0].split('.').pop().toLowerCase();
                return allowed.includes(ext);
            });
        }

        if (linksArray.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ success: true, total: 0, sent: 0, failed: 0, files: [], message: "الموقع ده محمي جداً أو مفيهوش ملفات حقيقية." }) };
        }

        // 3. تحميل وإرسال الملفات
        const results = { total: linksArray.length, sent: 0, failed: 0, files: [] };
        // هنبعت 5 ملفات بس عشان Netlify ميقطعش
        const filesToSend = linksArray.slice(0, 5); 

        for (const fileUrl of filesToSend) {
            const fileName = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]) || 'file';
            try {
                const fileResponse = await axios.get(fileUrl, {
                    responseType: 'arraybuffer',
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': targetUrl },
                    timeout: 10000
                });
                
                const buffer = Buffer.from(fileResponse.data);
                const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';

                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('document', new Blob([buffer], { type: contentType }), fileName);

                const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
                const tgData = await tgRes.json();

                if (tgData.ok) {
                    results.sent++;
                    results.files.push({ name: fileName, status: 'sent' });
                } else {
                    results.failed++;
                    results.files.push({ name: fileName, status: 'failed', reason: tgData.description });
                }
            } catch (err) {
                results.failed++;
                results.files.push({ name: fileName, status: 'failed', reason: err.message });
            }
        }

        return { statusCode: 200, body: JSON.stringify({ success: true, ...results }) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: "الموقع رفض الاتصال: " + error.message }) };
    }
};
