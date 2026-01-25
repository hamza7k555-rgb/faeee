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
    const { chatId, audio, filename } = JSON.parse(event.body);
    
    if (!chatId || !audio) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: "Missing required parameters" 
        })
      };
    }
    
    // تحويل Base64 إلى Blob
    const byteCharacters = atob(audio);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'audio/webm' });
    
    // إرسال الصوت للتليجرام
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', blob, filename || `audio_${Date.now()}.webm`);
    formData.append('caption', `🎤 تسجيل صوتي 10 ثواني\n⏰ ${new Date().toLocaleString('ar-EG')}`);
    formData.append('title', 'تسجيل صوتي');
    formData.append('performer', 'المستخدم');
    
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`, {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // جرب إرساله كوثيقة Document إذا فشل كصوت
      const formDataDoc = new FormData();
      formDataDoc.append('chat_id', chatId);
      formDataDoc.append('document', blob, filename || `audio_${Date.now()}.webm`);
      formDataDoc.append('caption', `🎤 تسجيل صوتي 10 ثواني\n⏰ ${new Date().toLocaleString('ar-EG')}`);
      
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
