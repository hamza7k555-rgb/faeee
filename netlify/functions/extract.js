const axios = require('axios');
const cheerio = require('cheerio');

// الامتدادات المسموحة (كل حاجة مهمة)
const ALLOWED_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|mp4|avi|mov|wmv|flv|mkv|mp3|wav|aac|ogg|m4a|txt|csv|json|xml|html|htm)(\?.*)?$/i;

// الحد الأقصى لحجم الملف الواحد (تيليجرام: 50MB للبوت)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// الحد الأقصى لعدد الملفات المرسلة في طلب واحد (تجنب timeout)
const MAX_FILES_PER_REQUEST = 15;

exports.handler = async function(event) {
    const BOT_TOKEN = process.env.BOT_TOKEN;

    if (!BOT_TOKEN) {
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: "Bot token not configured" })
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: "Invalid JSON" }) };
    }

    const { targetUrl, chatId, fileTypes } = body;

    if (!targetUrl || !chatId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, error: "targetUrl and chatId are required" })
        };
    }

    try {
        // 1. جلب الصفحة
        const { data: html } = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
            },
            timeout: 15000,
            maxRedirects: 5
        });

        const $ = cheerio.load(html);
        const foundLinks = new Set();
        const baseUrl = new URL(targetUrl);

        // دالة مساعدة لتحويل الروابط النسبية لمطلقة
        function absoluteUrl(link) {
            if (!link) return null;
            try {
                return new URL(link, targetUrl).href;
            } catch (e) {
                return null;
            }
        }

        // 2. استخراج من كل المصادر الممكنة
        // <img>
        $('img[src], img[data-src], img[data-original], img[data-lazy-src]').each((i, el) => {
            const link = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('data-lazy-src');
            const abs = absoluteUrl(link);
            if (abs && ALLOWED_EXTENSIONS.test(abs)) foundLinks.add(abs);
        });

        // <a href>
        $('a[href]').each((i, el) => {
            const abs = absoluteUrl($(el).attr('href'));
            if (abs && ALLOWED_EXTENSIONS.test(abs)) foundLinks.add(abs);
        });

        // <source> (فيديو/صوت)
        $('source[src]').each((i, el) => {
            const abs = absoluteUrl($(el).attr('src'));
            if (abs && ALLOWED_EXTENSIONS.test(abs)) foundLinks.add(abs);
        });

        // <video src>, <audio src>
        $('video[src], audio[src]').each((i, el) => {
            const abs = absoluteUrl($(el).attr('src'));
            if (abs && ALLOWED_EXTENSIONS.test(abs)) foundLinks.add(abs);
        });

        // <link href> (CSS, PDF embed, etc.)
        $('link[href]').each((i, el) => {
            const abs = absoluteUrl($(el).attr('href'));
            if (abs && ALLOWED_EXTENSIONS.test(abs)) foundLinks.add(abs);
        });

        // روابط داخل CSS style أو on* attributes
        $('[style*="url("]').each((i, el) => {
            const style = $(el).attr('style') || '';
            const matches = style.match(/url\(['"]?([^'")]+)['"]?\)/g) || [];
            matches.forEach(m => {
                const link = m.replace(/url\(['"]?|['"]?\)/g, '');
                const abs = absoluteUrl(link);
                if (abs && ALLOWED_EXTENSIONS.test(abs)) foundLinks.add(abs);
            });
        });

        let linksArray = Array.from(foundLinks);

        // 3. فلترة حسب الأنواع المختارة
        if (fileTypes && Array.isArray(fileTypes) && fileTypes.length > 0) {
            linksArray = linksArray.filter(link => {
                const ext = link.split('?')[0].split('.').pop().toLowerCase();
                return fileTypes.some(t => t.split(',').map(x => x.trim()).includes(ext));
            });
        }

        if (linksArray.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    total: 0,
                    sent: 0,
                    failed: 0,
                    files: [],
                    message: "لم يتم العثور على ملفات قابلة للاستخراج"
                })
            };
        }

        // 4. تحميل كل ملف ورفعه لتيليجرام
        const results = { total: linksArray.length, sent: 0, failed: 0, files: [] };
        const filesToSend = linksArray.slice(0, MAX_FILES_PER_REQUEST);

        for (const fileUrl of filesToSend) {
            const fileName = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]) || 'file';

            try {
                // تحميل الملف
                const fileResponse = await axios.get(fileUrl, {
                    responseType: 'arraybuffer',
                    timeout: 20000,
                    maxContentLength: MAX_FILE_SIZE,
                    maxBodyLength: MAX_FILE_SIZE,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': targetUrl
                    }
                });

                const fileBuffer = Buffer.from(fileResponse.data);
                const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';

                // تجاهل الملفات الكبيرة جداً
                if (fileBuffer.length > MAX_FILE_SIZE) {
                    results.failed++;
                    results.files.push({ name: fileName, status: 'failed', reason: 'too_large' });
                    continue;
                }

                // تجهيز FormData للرفع (تيليجرام يقبل multipart فقط للملفات)
                // نستخدم FormData المدمجة في Node 18+
                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('document', new Blob([fileBuffer], { type: contentType }), fileName);

                const tgResponse = await fetch(
                    `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
                    { method: 'POST', body: form }
                );

                const tgData = await tgResponse.json();

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

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                ...results,
                note: linksArray.length > MAX_FILES_PER_REQUEST
                    ? `تم إرسال أول ${MAX_FILES_PER_REQUEST} ملف فقط من أصل ${linksArray.length} (حد أقصى لتجنب timeout)`
                    : undefined
            })
        };

    } catch (error) {
        console.error('Extract error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: `فشل تحليل الموقع: ${error.message}`
            })
        };
    }
};
