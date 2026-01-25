exports.handler = async function(event, context) {
  // التوكن هنا بيجي من متغيرات Netlify فقط - مش في الكود
  const BOT_TOKEN = process.env.BOT_TOKEN;
  
  if (!BOT_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: "Bot token not configured. Please add BOT_TOKEN in Netlify environment variables." 
      })
    };
  }
  
  try {
    const { chatId, message } = JSON.parse(event.body);
    
    if (!chatId || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: "Missing chatId or message" 
        })
      };
    }
    
    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          success: false,
          error: data.description || "Telegram API error"
        })
      };
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        data: data 
      })
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: error.message 
      })
    };
  }
};
