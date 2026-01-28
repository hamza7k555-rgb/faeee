const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // التوكن من متغيرات Netlify
  const BOT_TOKEN = process.env.BOT_TOKEN;
  
  if (!BOT_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: "Bot token not configured" 
      })
    };
  }
  
  // التحقق من طريقة الطلب
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ 
        success: false,
        error: "Method not allowed" 
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
          error: "Missing required parameters" 
        })
      };
    }
    
    // إرسال الرسالة للتليجرام
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
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
      console.error('Telegram API error:', data);
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
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: error.message 
      })
    };
  }
};
