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

  try {
    let finalPrompt = userText;
    let imageUrl = null;

    const lower = userText.toLowerCase();
    const needsSearch = lower.includes('latest') || lower.includes('news') || lower.includes('today') || lower.includes('who is') || lower.includes('what is');
    
    if (needsSearch && serperKey) {
      // 1. Fetch text search results
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: userText })
      });
      const searchData = await searchRes.json();
      
      if (searchData.organic && searchData.organic.length > 0) {
        const snippets = searchData.organic.slice(0, 4).map(item => `${item.title}: ${item.snippet}`).join('\n');
        finalPrompt = `Answer the user question using these live search results:\n${snippets}\n\nUser Question: ${userText}`;
        
        // Grab image URL from organic result if available
        imageUrl = searchData.organic.find(item => item.imageUrl)?.imageUrl || null;
      }

      // 2. Fetch dedicated image if organic search had no thumbnail
      if (!imageUrl) {
        const imgRes = await fetch('https://google.serper.dev/images', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: userText, num: 1 })
        });
        const imgData = await imgRes.json();
        if (imgData.images && imgData.images.length > 0) {
          imageUrl = imgData.images[0].imageUrl;
        }
      }
    }

    // Call Direct Gemini 2.0 Flash API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `You are Ivy, a helpful personal AI assistant.\n\n${finalPrompt}` }]
          }
        ]
      })
    });

    const data = await response.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || data.error?.message || "Sorry, I couldn't process that.";

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    // Send Photo if an image was found, otherwise send text
    if (imageUrl) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption: replyText.slice(0, 1024), // Telegram caption character limit
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
