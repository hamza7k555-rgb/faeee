exports.handler = async function(event) {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) return { statusCode: 500, body: JSON.stringify({ error: "Bot token missing" }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: "Method Not Allowed" };

    let body;
    try { body = JSON.parse(event.body); } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    
    const { targetUrl, chatId } = body;
    if (!targetUrl || !chatId) return { statusCode: 400, body: JSON.stringify({ error: "Missing params" }) };

    // التأكد إن الرابط صحيح
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        return { statusCode: 400, body: JSON.stringify({ error: "الرابط غير صالح. يجب أن يبدأ بـ http أو https" }) };
    }

    try {
        const shortLinks = [];
        // هنعمل 5 طلبات عشان نجيب 5 روابط مختلفة
        // بنستخدم خدمة is.gd المجانية واللي مفيهاش حدود صارمة
        for (let i = 0; i < 5; i++) {
            try {
                // بنضيف باراميتر عشوائي في آخر الرابط عشان الخدمة ميديناش نفس الرابط كل مرة
                const uniqueUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + 'v=' + Date.now() + i;
                const response = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(uniqueUrl)}`);
                const data = await response.json();
                
                if (data.shorturl) {
                    shortLinks.push(data.shorturl);
                }
            } catch (e) {
                console.log("Error shortening:", e.message);
            }
            
            // تأخير بسيط عشان ميعملش حظر
            await new Promise(r => setTimeout(r, 300));
        }

        if (shortLinks.length === 0) {
            throw new Error("فشل في اختصار الروابط، جرب تاني.");
        }

        // تجهيز الرسالة اللي هتتبعت لتيليجرام
        let messageText = `🥂 <b>تم اختصار الرابط!</b>\n\n`;
        messageText += `🔗 <b>الرابط الأصلي:</b>\n<code>${targetUrl}</code>\n\n`;
        messageText += `📌 <b>الروابط المختصرة (${shortLinks.length}):</b>\n\n`;
        
        shortLinks.forEach((link, index) => {
            messageText += `${index + 1}. ${link}\n`;
        });

        // إرسال الرسالة لتيليجرام
        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: messageText,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });

        const tgData = await tgRes.json();
        if (!tgData.ok) throw new Error("فشل إرسال الرسالة على تيليجرام. تأكد أنك فتحت البوت وعملت Start.");

        return { statusCode: 200, body: JSON.stringify({ success: true, count: shortLinks.length }) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }
};
