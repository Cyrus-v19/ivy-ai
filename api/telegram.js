export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot is active');
  }

  const { message } = req.body;
  if (!message || !message.text) return res.status(200).json({ status: 'no message' });

  const chatId = message.chat.id;
  const userText = message.text;
  const geminiKey = process.env.GEMINI_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  try {
    const lowerText = userText.toLowerCase();

    // --- CHECK FOR IMAGE GENERATION REQUESTS ---
    const isImageGenerationRequest = lowerText.startsWith('/generate') || 
                                    lowerText.includes('generate an image') ||
                                    lowerText.includes('create an image') ||
                                    lowerText.includes('draw');

    if (isImageGenerationRequest) {
      // Clean up the prompt by removing the commands
      const imagePrompt = userText.replace(/^\/generate\s*/i, '')
                                 .replace(/generate an image of\s*/i, '')
                                 .replace(/create an image of\s*/i, '')
                                 .trim();

      // Make call to Imagen 3 endpoint
      const imageUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-images-fast:generateContent?key=${geminiKey}`;
      
      const imagenResponse = await fetch(imageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: imagePrompt }]
          }]
        })
      });

      const imagenData = await imagenResponse.json();
      
      // Look for the generated image data (Base64)
      const base64Image = imagenData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (base64Image) {
        // Prepare multipart form data for Telegram sendPhoto
        const formData = new FormData();
        formData.append('chat_id', chatId);
        
        // Convert base64 string to a Blob/File object
        const imageBlob = await fetch(`data:image/png;base64,${base64Image}`).then(r => r.blob());
        formData.append('photo', imageBlob, 'generated_image.png');
        formData.append('caption', `Here is the image I generated for: "${imagePrompt}"`);

        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: 'POST',
          body: formData // No specific Content-Type header needed for multipart/form-data with fetch
        });

      } else {
        const errorMessage = imagenData.error?.message || "I couldn't generate that image right now. Perhaps try a different prompt?";
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: errorMessage })
        });
      }

      // Exit early so it doesn't try standard text generation
      return res.status(200).json({ status: 'success' });
    }
    // --- END OF IMAGE GENERATION ---


    // --- STANDARD TEXT/NEWS GENERATION (Existing Logic) ---
    let finalPrompt = userText;
    let searchImageUrl = null;

    const needsSearch = lowerText.includes('latest') || lowerText.includes('news') || lowerText.includes('today') || lowerText.includes('who is') || lowerText.includes('what is');
    
    if (needsSearch && serperKey) {
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: userText })
      });
      const searchData = await searchRes.json();
      
      if (searchData.organic && searchData.organic.length > 0) {
        const snippets = searchData.organic.slice(0, 4).map(item => `${item.title}: ${item.snippet}`).join('\n');
        finalPrompt = `Answer the user question using these live search results:\n${snippets}\n\nUser Question: ${userText}`;
        searchImageUrl = searchData.organic.find(item => item.imageUrl)?.imageUrl || null;
      }

      if (!searchImageUrl) {
        const imgRes = await fetch('https://google.serper.dev/images', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: userText, num: 1 })
        });
        const imgData = await imgRes.json();
        if (imgData.images && imgData.images.length > 0) {
          searchImageUrl = imgData.images[0].imageUrl;
        }
      }
    }

    // Call Gemini for text/news (using your existing retry logic)
    const models = ['gemini-flash-latest', 'gemini-1.5-flash'];
    let replyText = null;

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: `You are Ivy, a helpful personal AI assistant.\n\n${finalPrompt}` }]
          }]
        })
      });

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (content) {
        replyText = content;
        break;
      }
    }

    if (!replyText) {
      replyText = "Ivy is currently experiencing high demand. Please try sending your message again in a moment!";
    }

    // Send Photo (for news) if an image was found, otherwise send text
    if (searchImageUrl) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: searchImageUrl,
          caption: replyText.slice(0, 1024),
          parse_mode: 'Markdown'
        })
      });
    } else {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          parse_mode: 'Markdown'
        })
      });
    }

  } catch (err) {
    console.error(err);
  }

  return res.status(200).json({ status: 'success' });
  }
