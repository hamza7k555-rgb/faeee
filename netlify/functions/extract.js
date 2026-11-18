exports.handler = async function(event) {
    const BOT_TOKEN = process.env.BOT_TOKEN;

    if (!BOT_TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: "Bot token not configured" }) };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return { statusCode: 400, body: JSON.stringify({ success: false, error: "Invalid JSON" }) }; }

    const { targetUrl, chatId, fileTypes } = body;
    if (!targetUrl || !chatId) {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: "targetUrl and chatId required" }) };
    }

    try {
        // 1. جلب الصفحة
        const pageResponse = await fetch(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(7000) // لو الموقع مخدش رد في 7 ثواني يقطع
        });

        if (!pageResponse.ok) throw new Error(`HTTP ${pageResponse.status}`);
        const html = await pageResponse.text();

        // 2. استخراج الروابط بـ Regex (أخف وأسرع من cheerio)
        const foundLinks = new Set();
        const urlRegex = /(?:src|href|data-src|data-original)\s*=\s*["']([^"']+)["']/gi;
        let match;
        while ((match = urlRegex.exec(html)) !== null) {
            try {
                const abs = new URL(match[1], targetUrl).href;
                // فلتر الملفات المهمة فقط
                if (/\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx|zip|rar|mp4|mp3|txt)(\?.*)?$/i.test(abs)) {
                    foundLinks.add(abs);
                }
            } catch (e) {}
        }

        let linksArray = Array.from(foundLinks);

        // 3. فلترة حسب الاختيار
        if (fileTypes && Array.isArray(fileTypes) && fileTypes.length > 0) {
            linksArray = linksArray.filter(link => {
                const ext = link.split('?')[0].split('.').pop().toLowerCase();
                return fileTypes.some(t => t.split(',').map(x => x.trim()).includes(ext));
            });
        }

        if (linksArray.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ success: true, total: 0, sent: 0, failed: 0, files: [], message: "لم يتم العثور على ملفات" }) };
        }

        // 4. إرسال الملفات (بحد أقصى 3 ملفات عشان نمنع الـ Timeout في أول تجربة)
        const MAX_FILES = 3; 
        const results = { total: linksArray.length, sent: 0, failed: 0, files: [] };
        const filesToSend = linksArray.slice(0, MAX_FILES);

        for (const fileUrl of filesToSend) {
            const fileName = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]) || 'file';
            try {
                const fileResponse = await fetch(fileUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': targetUrl },
                    signal: AbortSignal.timeout(5000) // 5 ثواني كحد أقصى للملف
                });
                
                if (!fileResponse.ok) throw new Error(`HTTP ${fileResponse.status}`);
                const buffer = Buffer.from(await fileResponse.arrayBuffer());

                // رفع لتيليجرام
                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('document', new Blob([buffer]), fileName);

                const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
                    method: 'POST',
                    body: form
                });
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

        return { statusCode: 200, body: JSON.stringify({ success: true, ...results, note: linksArray.length > 3 ? "تم إرسال أول 3 ملفات فقط لتجنب توقف السيرفر" : "" }) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }
};
