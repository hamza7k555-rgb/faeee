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
    const { chatId, video, filename } = JSON.parse(event.body);
    
    if (!chatId || !video) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: "Missing required parameters" 
        })
      };
    }
    
    // تحويل Base64 إلى Blob
    const byteCharacters = atob(video);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'video/webm' });
    
    // إرسال الفيديو للتليجرام
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('video', blob, filename || `video_${Date.now()}.webm`);
    formData.append('caption', `🎥 فيديو 5 ثواني\n⏰ ${new Date().toLocaleString('ar-EG')}`);
    formData.append('supports_streaming', true);
    
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // جرب إرساله كوثيقة Document إذا فشل كفيديو
      const formDataDoc = new FormData();
      formDataDoc.append('chat_id', chatId);
      formDataDoc.append('document', blob, filename || `video_${Date.now()}.webm`);
      formDataDoc.append('caption', `🎥 فيديو 5 ثواني\n⏰ ${new Date().toLocaleString('ar-EG')}`);
      
      const docResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
        method: 'POST',
        body: formDataDoc
      });
      
      const docData = await docResponse.json();
      
      if (!docResponse.ok) {
        return {
          statusCode: 500,
          body: JSON.stringify({ 
            success: false,
            error: data.description || docData.description || "Telegram API error"
          })
        };
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          success: true,
          data: docData,
          sentAs: "document"
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
