exports.handler = async function(event, context) {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) return { statusCode: 500, body: JSON.stringify({ success: false, error: "BOT_TOKEN missing" }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: "Method Not Allowed" };

    let body;
    try { body = JSON.parse(event.body); } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    const { chatId, files } = body;

    if (!chatId || !files || files.length === 0) return { statusCode: 400, body: JSON.stringify({ error: "Missing params" }) };

    try {
        let sentCount = 0;
        // بناخد أول 10 ملفات عشان نضمن مفيش Timeout
        const filesToSend = files.slice(0, 10);

        for (const file of filesToSend) {
            try {
                const fileResponse = await fetch(file.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (!fileResponse.ok) continue;
                
                const buffer = Buffer.from(await fileResponse.arrayBuffer());
                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('document', new Blob([buffer]), file.name);

                const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
                const tgData = await tgRes.json();
                if (tgData.ok) sentCount++;
            } catch (err) { console.log("Failed:", file.name); }
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ success: true, sent: sentCount, total: files.length }) 
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }
};
