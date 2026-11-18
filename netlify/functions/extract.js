exports.handler = async function(event) {
    const BOT_TOKEN = process.env.BOT_TOKEN;

    // 1. التأكد من التوكن
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
        // 2. جلب الصفحة بتنكر شديد جداً عشان نكسر الحماية
        const pageResponse = await fetch(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
            },
            // لو الموقع مخدش رد في 7 ثواني بيقطع عشان منعملش Timeout
            signal: AbortSignal.timeout(7000) 
        });

        if (!pageResponse.ok) {
            return { statusCode: 200, body: JSON.stringify({ success: true, total: 0, sent: 0, failed: 0, files: [], message: "الموقع رفض الاتصال (حماية قوية)" }) };
        }

        const html = await pageResponse.text();
        const foundLinks = new Set();

        // 3. استخراج كل حاجة (صور، كود، فيديو، صوت، إلخ)
        const regex = /(?:https?:\/\/|\/)[^\s"'<>\(\)]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|ico|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|mp4|avi|mov|wmv|flv|mkv|mp3|wav|aac|ogg|m4a|txt|csv|json|xml|js|css|map|woff|woff2|ttf|otf)(?:\?[^\s"'<>]*)?/gi;
        
        let match;
        while ((match = regex.exec(html)) !== null) {
            try {
                const abs = new URL(match[0], targetUrl).href;
                if (abs.startsWith('http') && !abs.includes('w3.org') && !abs.includes('schema.org') && !abs.includes('google-analytics')) {
                    foundLinks.add(abs);
                }
            } catch (e) {}
        }

        // 3.1 سرقة روابط الصور المخفية في الستايل (background-image)
        const styleRegex = /url\(['"]?([^'")]+)['"]?\)/gi;
        while ((match = styleRegex.exec(html)) !== null) {
            try {
                const abs = new URL(match[1], targetUrl).href;
                if (abs.startsWith('http')) foundLinks.add(abs);
            } catch (e) {}
        }

        // 3.2 سرقة روابط الملفات المخفية جوه السكربتات
        const scriptRegex = /(https?:\/\/[^\s"'<>\(\)]+\.(jpg|jpeg|png|gif|webp|pdf|zip|mp4|mp3|docx|xlsx|svg|ico|js|css))/gi;
        while ((match = scriptRegex.exec(html)) !== null) {
            const abs = match[1];
            if (!abs.includes('w3.org') && !abs.includes('google-analytics')) {
                foundLinks.add(abs);
            }
        }

        const linksArray = Array.from(foundLinks);

        if (linksArray.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ success: true, total: 0, sent: 0, failed: 0, files: [], message: "لم يتم العثور على ملفات في الكود المصدري." }) };
        }

        // 4. تحميل وإرسال الملفات
        const results = { total: linksArray.length, sent: 0, failed: 0, files: [] };
        
        // 🚨 السر هنا: بناخد 4 ملفات بس عشان نضمن إن السيرفر ميهنجش 
        // (لو عايز أكتر من كده لازم نغير طريقة الإرسال لـ Background Function)
        const filesToSend = linksArray.slice(0, 4); 

        for (const fileUrl of filesToSend) {
            const fileName = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]) || 'file';
            try {
                const fileResponse = await fetch(fileUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': targetUrl },
                    signal: AbortSignal.timeout(5000) // 5 ثواني كحد أقصى للملف
                });
                
                if (!fileResponse.ok) throw new Error("فشل التحميل");
                
                const arrayBuffer = await fileResponse.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';

                // إرسال لتيليجرام
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
                note: linksArray.length > 4 ? `تم العثور على ${linksArray.length} ملف، وتم إرسال أول 4 ملفات فقط لتجنب توقف السيرفر.` : "" 
            }) 
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }
};
