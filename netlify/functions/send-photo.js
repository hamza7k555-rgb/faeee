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
  
  try {
    const { chatId, photo, photoNumber } = JSON.parse(event.body);
    
    if (!chatId || !photo) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: "Missing required parameters" 
        })
      };
    }
    
    // تحويل Base64 إلى Blob
    const byteCharacters = atob(photo);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/jpeg' });
    
    // إرسال الصورة للتليجرام
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('photo', blob, `photo_${photoNumber}.jpg`);
    formData.append('caption', `📸 الصورة رقم ${photoNumber}\n⏰ ${new Date().toLocaleString('ar-EG')}`);
    
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: formData
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
