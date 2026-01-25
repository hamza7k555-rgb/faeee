exports.handler = async function(event, context) {
  // التوكن من متغيرات Netlify
  const BOT_TOKEN = process.env.BOT_TOKEN;
  
  if (!BOT_TOKEN) {
    return {
      statusCode: 200, // نرجع 200 عشان مايوقفش العملية
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
        statusCode: 200, // نرجع 200 عشان مايوقفش العملية
        body: JSON.stringify({ 
          success: false,
          error: "Missing required parameters" 
        })
      };
    }
    
    // تحويل Base64 إلى Blob بسرعة
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
    
    // إرسال بدون انتظار
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: formData
    }).catch(() => {}); // تجاهل الأخطاء
    
    // نرجع فوراً بدون انتظار
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        message: "Photo sent (async)" 
      })
    };
    
  } catch (error) {
    return {
      statusCode: 200, // نرجع 200 حتى لو فيه خطأ
      body: JSON.stringify({ 
        success: false,
        error: error.message 
      })
    };
  }
};
