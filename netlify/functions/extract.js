exports.handler = async function(event) {
    const BOT_TOKEN = process.env.BOT_TOKEN;

    // 1. التأكد من التوكن والطلب
    if (!BOT_TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: "Bot token not configured" }) };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    let body;
    try { body = JSON.parse(event.body); } 
    catch (e) { return { statusCode: 400, body: JSON.stringify({ success: false, error: "Invalid JSON" }) }; }

    const { targetUrl, chatId } = body;
    if (!targetUrl || !chatId) {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: "Missing params" }) };
    }

    try {
        // 2. جلب الصفحة (بشكل عادي جداً)
        const pageResponse = await fetch(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        if (!pageResponse.ok) {
            return { statusCode: 200, body: JSON.stringify({ success: true, total: 0, sent: 0, failed: 0, files: [], message: "الموقع رفض الاتصال (حماية)" }) };
        }

        const html = await pageResponse.text();

        // 3. استخراج الملفات (عن طريق Regex قوي جداً)
        const foundLinks = new Set();
        // بيدور على أي رابط ملف جوه الكود (src, href, style, scripts)
        const regex = /(?:https?:\/\/|\/)[^\s"'<>\(\)]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|ico|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|mp4|avi|mov|wmv|flv|mkv|mp3|wav|aac|ogg|m4a|txt|csv|json|xml)(?:\?[^\s"'<>]*)?/gi;
        
        let match;
        while ((match = regex.exec(html)) !== null) {
            try {
                // تحويل الرابط لرابط كامل
                const abs = new URL(match[0], targetUrl).href;
                // التأكد إنه رابط سليم
                if (abs.startsWith('http') && !abs.includes('w3.org') && !abs.includes('schema.org')) {
                    foundLinks.add(abs);
                }
            } catch (e) {}
        }

        const linksArray = Array.from(foundLinks);

        if (linksArray.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ success: true, total: 0, sent: 0, failed: 0, files: [], message: "لم يتم العثور على ملفات." }) };
        }

        // 4. تحميل وإرسال أول 3 ملفات
        const results = { total: linksArray.length, sent: 0, failed: 0, files: [] };
        const filesToSend = linksArray.slice(0, 3); // 3 ملفات فقط عشان نضمن مفيش Timeout

        for (const fileUrl of filesToSend) {
            const fileName = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]) || 'file';
            try {
                // تحميل الملف
                const fileResponse = await fetch(fileUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': targetUrl }
                });
                
                if (!fileResponse.ok) throw new Error("فشل تحميل الملف");
                
                const arrayBuffer = await fileResponse.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';

                // إرسال لتيليجرام (باستخدام FormData المدمجة في Node)
                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('document', new Blob([buffer], { type: contentType }), fileName);

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

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                success: true, 
                ...results, 
                note: linksArray.length > 3 ? `تم العثور على ${linksArray.length} ملف، وتم إرسال أول 3 ملفات لتجنب توقف السيرفر.` : "" 
            }) 
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }
};
