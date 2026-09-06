export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot is active');
  }

  const { message } = req.body;
  if (!message || !message.text) return res.status(200).json({ status: 'no message' });

  const chatId = message.chat.id;
  const userText = message.text;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  try {
    let finalPrompt = userText;

    const lower = userText.toLowerCase();
    const needsSearch = lower.includes('latest') || lower.includes('news') || lower.includes('today') || lower.includes('who is') || lower.includes('what is');
    
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
      }
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + openrouterKey
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          { role: 'system', content: 'You are Ivy, a helpful personal AI assistant.' },
          { role: 'user', content: finalPrompt }
        ],
        max_tokens: 1000
      })
    });

    const data = await response.json();
    const replyText = data.choices?.[0]?.message?.content || "Sorry, I couldn't process that.";

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: replyText, parse_mode: 'Markdown' })
    });

  } catch (err) {
    console.error(err);
  }

  return res.status(200).json({ status: 'success' });
    }
