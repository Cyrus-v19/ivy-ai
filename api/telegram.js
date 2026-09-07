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
  const groqKey = process.env.GROQ_API_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  try {
    const lowerText = userText.toLowerCase();

    // --- 1. IMAGE GENERATION HANDLER ---
    const isImageRequest = lowerText.startsWith('/generate') || 
                           lowerText.includes('generate an image') ||
                           lowerText.includes('create an image') ||
                           lowerText.includes('show me an image') ||
                           lowerText.includes('draw');

    if (isImageRequest) {
      const imagePrompt = userText.replace(/^\/generate\s*/i, '')
                                 .replace(/generate an image of\s*/i, '')
                                 .replace(/create an image of\s*/i, '')
                                 .replace(/show me an image of\s*/i, '')
                                 .replace(/draw a\s*/i, '')
                                 .replace(/draw\s*/i, '')
                                 .trim();

      // Imagen 3 Call via Gemini
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
        console.error("Imagen API call failed:", e);
      }

      // Fallback: Serper Images
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

    // --- 2. REAL-TIME SEARCH & SYSTEM CONTEXT ---
    let finalPrompt = userText;
    let searchImageUrl = null;
    const currentDate = new Date().toISOString().split('T')[0];

    const searchKeywords = [
      'latest', 'news', 'today', 'yesterday', 'who is', 'what is', 'where is',
      'when is', 'score', 'match', 'price', 'rate', 'weather', 'happened',
      'recent', 'update', 'current', 'release date', 'winner', 'election'
    ];

    const needsSearch = searchKeywords.some(keyword => lowerText.includes(keyword));

    if (needsSearch && serperKey) {
      const isNewsQuery = lowerText.includes('news') || lowerText.includes('latest') || lowerText.includes('update');
      const serperEndpoint = isNewsQuery ? 'https://google.serper.dev/news' : 'https://google.serper.dev/search';

      const searchRes = await fetch(serperEndpoint, {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: userText })
      });
      const searchData = await searchRes.json();

      const results = isNewsQuery ? searchData.news : searchData.organic;

      if (results && results.length > 0) {
        const snippets = results.slice(0, 5).map(item => {
          const dateStr = item.date ? `[Date: ${item.date}] ` : '';
          return `${dateStr}${item.title}: ${item.snippet}`;
        }).join('\n');

        finalPrompt = `Answer the user question using these live search results as your primary context.\n\nLive Search Data:\n${snippets}\n\nUser Question: ${userText}`;
        searchImageUrl = results.find(item => item.imageUrl)?.imageUrl || null;
      }
    }

    // --- 3. GROQ ENGINE WITH DETAILED ERROR LOGGING ---
    let replyText = null;

    if (groqKey) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'system',
                content: `You are Ivy, an intelligent personal AI assistant. Today's UTC date is ${currentDate}. Always treat live search data as absolute truth for recent events.`
              },
              {
                role: 'user',
                content: finalPrompt
              }
            ],
            temperature: 0.7
          })
        });

        const groqData = await groqRes.json();
        if (groqData.choices?.[0]?.message?.content) {
          replyText = groqData.choices[0].message.content;
        } else {
          console.error("Groq API Response Error:", JSON.stringify(groqData));
        }
      } catch (err) {
        console.error("Groq request fetch failed:", err);
      }
    } else {
      console.error("GROQ_API_KEY is missing from process.env!");
    }

    // Fallback: Gemini
    if (!replyText && geminiKey) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{ text: `You are Ivy, an intelligent personal AI assistant. Today's UTC date is ${currentDate}.\n\n${finalPrompt}` }]
            }]
          })
        });
        const geminiData = await geminiRes.json();
        replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      } catch (err) {
        console.error("Gemini fallback failed:", err);
      }
    }

    if (!replyText) {
      replyText = "Ivy is briefly offline. Please try sending your request again in a few seconds!";
    }

    // Deliver Payload
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
    console.error("Handler error:", err);
  }

  return res.status(200).json({ status: 'success' });
  }
