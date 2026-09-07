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

    // --- 1. DIRECT IMAGE GENERATION / SEARCH REQUESTS ---
    const isImageRequest = lowerText.startsWith('/generate') || 
                           lowerText.includes('generate an image') ||
                           lowerText.includes('create an image') ||
                           lowerText.includes('show me an image') ||
                           lowerText.includes('draw');

    if (isImageRequest && serperKey) {
      const imagePrompt = userText.replace(/^\/generate\s*/i, '')
                                 .replace(/generate an image of\s*/i, '')
                                 .replace(/create an image of\s*/i, '')
                                 .replace(/show me an image of\s*/i, '')
                                 .trim();

      // Fetch dedicated high-res image via Serper Images
      const imgRes = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: imagePrompt, num: 1 })
      });
      const imgData = await imgRes.json();
      const imageUrl = imgData.images?.[0]?.imageUrl;

      if (imageUrl) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            photo: imageUrl,
            caption: `Here is the image for: "${imagePrompt}"`
          })
        });
      } else {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: "I couldn't find an image for that prompt. Try another description!" })
        });
      }

      return res.status(200).json({ status: 'success' });
    }

    // --- 2. TEXT & SEARCH LOGIC ---
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

    // Modern active model aliases
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
            parts: [{ text: `You are Ivy, a helpful personal AI assistant.\n\n${finalPrompt}` }]
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
