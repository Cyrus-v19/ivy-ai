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

    // Expanded Intent Check for Image Generation
    const isImageRequest = lowerText.startsWith('/generate') || 
                           lowerText.includes('generate') ||
                           lowerText.includes('create an image') ||
                           lowerText.includes('draw') ||
                           lowerText.includes('picture of') ||
                           lowerText.includes('photo of');

    if (isImageRequest) {
      const imagePrompt = userText.replace(/^\/generate\s*/i, '')
                                 .replace(/generate an image of\s*/i, '')
                                 .replace(/create an image of\s*/i, '')
                                 .replace(/draw a\s*/i, '')
                                 .replace(/draw\s*/i, '')
                                 .trim();

      // 1. TRY DIRECT IMAGEN 3 GENERATION
      try {
        const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiKey}`;
        const imagenRes = await fetch(imagenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: imagePrompt }],
            parameters: { sampleCount: 1, aspectRatio: "1:1" }
          })
        });

        const imagenData = await imagenRes.json();
        const base64Image = imagenData.predictions?.[0]?.bytesBase64Encoded;

        if (base64Image) {
          const formData = new FormData();
          formData.append('chat_id', chatId);
          const imageBlob = await fetch(`data:image/png;base64,${base64Image}`).then(r => r.blob());
          formData.append('photo', imageBlob, 'generated_image.png');
          formData.append('caption', `Generated image for: "${imagePrompt}"`);

          await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            body: formData
          });
          return res.status(200).json({ status: 'success' });
        }
      } catch (e) {
        console.error("Imagen 3 failed, falling back to Serper image search:", e);
      }

      // 2. FALLBACK TO SERPER IMAGE SEARCH IF IMAGEN FAILS OR IS UNAVAILABLE
      if (serperKey) {
        const imgRes = await fetch('https://google.serper.dev/images', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: imagePrompt, num: 1 })
        });
        const imgData = await imgRes.json();
        const searchImageUrl = imgData.images?.[0]?.imageUrl;

        if (searchImageUrl) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              photo: searchImageUrl,
              caption: `Here is an image for: "${imagePrompt}"`
            })
          });
          return res.status(200).json({ status: 'success' });
        }
      }
    }

    // --- STANDARD TEXT & NEWS ROUTING ---
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
    }

    const models = ['gemini-flash-latest', 'gemini-pro-latest'];
    let replyText = null;

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: `You are Ivy, an AI assistant. Never claim you cannot generate images directly; if an image was requested, generate or display it.\n\n${finalPrompt}` }]
          }]
        })
      });

      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        replyText = data.candidates[0].content.parts[0].text;
        break;
      }
    }

    if (!replyText) {
      replyText = "Ivy is currently experiencing high demand. Please try sending your message again in a moment!";
    }

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
